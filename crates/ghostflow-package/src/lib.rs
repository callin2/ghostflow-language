//! Native verification for `GhostFlow/portable-package-v1` transport bytes.
//!
//! This crate deliberately verifies the package boundary before a target loader
//! sees GFB1 bytes. It does not replace the compiler-owned source-trace
//! semantic verifier that the trusted package builder runs before signing.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::fmt;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use ed25519_dalek::{Signature, Verifier as _, VerifyingKey};
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest as _, Sha256};

pub const PACKAGE_FORMAT: &str = "GhostFlow/portable-package-v1";
pub const PAYLOAD_FORMAT: &str = "GhostFlow/portable-payload-v1";
pub const SOURCE_FORMAT: &str = "GhostFlow/source-document-v1";
pub const SOURCE_MAP_FORMAT: &str = "GhostFlow/source-map-v1";
pub const SOURCE_MEDIA_TYPE: &str = "text/markdown; profile=ghostflow-literate";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ErrorCode {
    InvalidTransport,
    PackageTooLarge,
    InvalidSchema,
    UnknownOrMissingField,
    SignatureCount,
    UnsupportedPackageFormat,
    UnsupportedPayloadFormat,
    InvalidCanonicalJson,
    NoncanonicalJson,
    InvalidIdentity,
    InvalidVerifierOptions,
    InvalidDigest,
    DigestMismatch,
    InvalidTrustStore,
    SigningKeyRevoked,
    UntrustedSignature,
    UnsupportedSignatureAlgorithm,
    DuplicateSignature,
    InvalidBase64,
    ArtifactTooLarge,
    NoncanonicalSource,
    SourceDigestMismatch,
    BytecodeDigestMismatch,
    ManifestDigestMismatch,
    SourceMapDigestMismatch,
    InvalidBytecodeFormat,
    UnsupportedBytecodeVersion,
    BytecodeVersionMismatch,
    CompilerRevisionMismatch,
    UnsupportedRuntimeSemantics,
    UnsupportedRuntimeAbi,
    BindingRevisionMismatch,
    UnsupportedManifestFormat,
    InvalidCapabilities,
    DuplicateCapability,
    NoncanonicalCapabilities,
    MissingCapability,
    ManifestMismatch,
    CapabilityManifestMismatch,
    UnsupportedSourceMapFormat,
    SourceMapMismatch,
    InvalidUtf8,
    BytecodeRejected,
}

impl ErrorCode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::InvalidTransport => "invalid-transport",
            Self::PackageTooLarge => "package-too-large",
            Self::InvalidSchema => "invalid-schema",
            Self::UnknownOrMissingField => "unknown-or-missing-field",
            Self::SignatureCount => "signature-count",
            Self::UnsupportedPackageFormat => "unsupported-package-format",
            Self::UnsupportedPayloadFormat => "unsupported-payload-format",
            Self::InvalidCanonicalJson => "invalid-canonical-json",
            Self::NoncanonicalJson => "noncanonical-json",
            Self::InvalidIdentity => "invalid-identity",
            Self::InvalidVerifierOptions => "invalid-verifier-options",
            Self::InvalidDigest => "invalid-digest",
            Self::DigestMismatch => "digest-mismatch",
            Self::InvalidTrustStore => "invalid-trust-store",
            Self::SigningKeyRevoked => "signing-key-revoked",
            Self::UntrustedSignature => "untrusted-signature",
            Self::UnsupportedSignatureAlgorithm => "unsupported-signature-algorithm",
            Self::DuplicateSignature => "duplicate-signature",
            Self::InvalidBase64 => "invalid-base64",
            Self::ArtifactTooLarge => "artifact-too-large",
            Self::NoncanonicalSource => "noncanonical-source",
            Self::SourceDigestMismatch => "source-digest-mismatch",
            Self::BytecodeDigestMismatch => "bytecode-digest-mismatch",
            Self::ManifestDigestMismatch => "manifest-digest-mismatch",
            Self::SourceMapDigestMismatch => "source-map-digest-mismatch",
            Self::InvalidBytecodeFormat => "invalid-bytecode-format",
            Self::UnsupportedBytecodeVersion => "unsupported-bytecode-version",
            Self::BytecodeVersionMismatch => "bytecode-version-mismatch",
            Self::CompilerRevisionMismatch => "compiler-revision-mismatch",
            Self::UnsupportedRuntimeSemantics => "unsupported-runtime-semantics",
            Self::UnsupportedRuntimeAbi => "unsupported-runtime-abi",
            Self::BindingRevisionMismatch => "binding-revision-mismatch",
            Self::UnsupportedManifestFormat => "unsupported-manifest-format",
            Self::InvalidCapabilities => "invalid-capabilities",
            Self::DuplicateCapability => "duplicate-capability",
            Self::NoncanonicalCapabilities => "noncanonical-capabilities",
            Self::MissingCapability => "missing-capability",
            Self::ManifestMismatch => "manifest-mismatch",
            Self::CapabilityManifestMismatch => "capability-manifest-mismatch",
            Self::UnsupportedSourceMapFormat => "unsupported-source-map-format",
            Self::SourceMapMismatch => "source-map-mismatch",
            Self::InvalidUtf8 => "invalid-utf8",
            Self::BytecodeRejected => "bytecode-rejected",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PortablePackageError {
    pub code: ErrorCode,
    pub message: String,
}

impl fmt::Display for PortablePackageError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code.as_str(), self.message)
    }
}

impl std::error::Error for PortablePackageError {}

pub type Result<T> = std::result::Result<T, PortablePackageError>;

fn fail<T>(code: ErrorCode, message: impl Into<String>) -> Result<T> {
    Err(PortablePackageError {
        code,
        message: message.into(),
    })
}

#[derive(Clone, Copy, Debug)]
pub struct VerifierLimits {
    pub max_transport_bytes: usize,
    pub max_signed_payload_bytes: usize,
    pub max_artifact_bytes: usize,
    pub max_signatures: usize,
    pub max_capabilities: usize,
    pub max_json_depth: usize,
}

impl Default for VerifierLimits {
    fn default() -> Self {
        Self {
            // Four 1 MiB artifacts encoded as base64 plus envelope overhead.
            max_transport_bytes: 6 * 1024 * 1024,
            max_signed_payload_bytes: 4 * 1024 * 1024,
            max_artifact_bytes: 1024 * 1024,
            max_signatures: 8,
            max_capabilities: 256,
            max_json_depth: 64,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Ord, PartialOrd)]
pub struct Capability {
    pub kind: String,
    pub name: String,
    pub value_type: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PackageIdentity {
    pub compiler_revision: String,
    pub runtime_semantics: String,
    pub runtime_abi: String,
    pub required_capabilities: Vec<Capability>,
    pub binding_revision: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TrustedKey {
    pub key_id: String,
    pub public_key: [u8; 32],
}

pub struct TargetLoaderContext<'a> {
    pub manifest: &'a Value,
    pub source_map: &'a Value,
    pub identity: &'a PackageIdentity,
}

/// The target must return `Ok(true)` only after its native GFB1 loader accepts
/// the bytes. Returning false or an error prevents bytecode exposure.
pub trait TargetLoader {
    fn accept(
        &self,
        bytecode: &[u8],
        context: &TargetLoaderContext<'_>,
    ) -> std::result::Result<bool, String>;
}

impl<F> TargetLoader for F
where
    F: Fn(&[u8], &TargetLoaderContext<'_>) -> std::result::Result<bool, String>,
{
    fn accept(
        &self,
        bytecode: &[u8],
        context: &TargetLoaderContext<'_>,
    ) -> std::result::Result<bool, String> {
        self(bytecode, context)
    }
}

/// Publisher authentication is strict unless a development host explicitly opts out.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum SignaturePolicy {
    #[default]
    Enforce,
    DevelopmentBypass,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SignatureAuthentication {
    Authenticated,
    DevelopmentBypass,
}

pub struct VerificationProfile<'a> {
    pub trusted_keys: &'a [TrustedKey],
    pub revoked_key_ids: &'a [String],
    pub expected_compiler_revision: &'a str,
    pub supported_runtime_semantics: &'a [String],
    pub supported_runtime_abis: &'a [String],
    pub supported_manifest_formats: &'a [String],
    pub available_capabilities: &'a [Capability],
    pub expected_binding_revision: &'a str,
    pub target_loader: &'a dyn TargetLoader,
    pub limits: VerifierLimits,
}

#[derive(Clone, Debug)]
pub struct VerifiedSource {
    pub filename: String,
    pub text: String,
    pub sha256: String,
}

#[derive(Clone, Debug)]
pub struct VerifiedPackage {
    pub package_format: &'static str,
    pub payload_sha256: String,
    pub accepted_key_ids: Vec<String>,
    pub signature_authentication: SignatureAuthentication,
    pub source: VerifiedSource,
    pub manifest: Value,
    pub source_map: Value,
    pub identity: PackageIdentity,
    bytecode: Vec<u8>,
    bytecode_sha256: String,
}

impl VerifiedPackage {
    pub fn bytecode_sha256(&self) -> &str {
        &self.bytecode_sha256
    }
    pub fn bytecode_len(&self) -> usize {
        self.bytecode.len()
    }
    pub fn bytecode_copy(&self) -> Vec<u8> {
        self.bytecode.clone()
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Envelope {
    format: String,
    payload: Value,
    #[serde(rename = "payloadSha256")]
    payload_sha256: String,
    signatures: Vec<SignatureWire>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SignatureWire {
    algorithm: String,
    #[serde(rename = "keyId")]
    key_id: String,
    #[serde(rename = "signatureBase64")]
    signature_base64: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PayloadWire {
    format: String,
    source: SourceWire,
    bytecode: BytecodeWire,
    manifest: JsonArtifactWire,
    #[serde(rename = "sourceMap")]
    source_map: JsonArtifactWire,
    identity: IdentityWire,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SourceWire {
    format: String,
    kind: String,
    filename: String,
    #[serde(rename = "mediaType")]
    media_type: String,
    sha256: String,
    #[serde(rename = "contentBase64")]
    content_base64: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BytecodeWire {
    format: String,
    version: String,
    sha256: String,
    #[serde(rename = "contentBase64")]
    content_base64: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct JsonArtifactWire {
    format: String,
    sha256: String,
    #[serde(rename = "contentBase64")]
    content_base64: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct IdentityWire {
    compiler_revision: String,
    runtime_semantics: String,
    runtime_abi: String,
    required_capabilities: Vec<CapabilityWire>,
    binding_revision: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CapabilityWire {
    kind: String,
    name: String,
    #[serde(rename = "type")]
    value_type: String,
}

fn parse_wire<T: for<'a> Deserialize<'a>>(value: Value, label: &str) -> Result<T> {
    serde_json::from_value(value).map_err(|error| PortablePackageError {
        code: if error.to_string().contains("unknown field")
            || error.to_string().contains("missing field")
        {
            ErrorCode::UnknownOrMissingField
        } else {
            ErrorCode::InvalidSchema
        },
        message: format!("{label}: {error}"),
    })
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut text = String::with_capacity(64);
    for byte in digest {
        use fmt::Write as _;
        let _ = write!(&mut text, "{byte:02x}");
    }
    text
}

fn valid_identifier(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.is_empty() || bytes.len() > 128 || !bytes[0].is_ascii_alphanumeric() {
        return false;
    }
    bytes.iter().all(|byte| {
        byte.is_ascii_alphanumeric() || matches!(*byte, b'.' | b'_' | b':' | b'/' | b'+' | b'-')
    })
}

fn require_identifier(value: &str, label: &str) -> Result<()> {
    if valid_identifier(value) {
        Ok(())
    } else {
        fail(
            ErrorCode::InvalidIdentity,
            format!("{label} must be a bounded identifier"),
        )
    }
}

fn require_digest(value: &str, label: &str) -> Result<()> {
    if value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
    {
        Ok(())
    } else {
        fail(
            ErrorCode::InvalidDigest,
            format!("{label} must be a lowercase SHA-256 digest"),
        )
    }
}

fn require_source_filename(value: &str, label: &str) -> Result<()> {
    let utf16_len = value.encode_utf16().count();
    if (10..=256).contains(&utf16_len) && !value.contains('\0') && value.ends_with(".ghost.md") {
        Ok(())
    } else {
        fail(
            ErrorCode::NoncanonicalSource,
            format!("{label} must be a bounded .ghost.md filename"),
        )
    }
}

fn require_ghost_name(value: &str, label: &str) -> Result<()> {
    let bytes = value.as_bytes();
    if !bytes.is_empty()
        && (bytes[0].is_ascii_alphabetic() || bytes[0] == b'_')
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || *byte == b'_')
    {
        Ok(())
    } else {
        fail(
            ErrorCode::ManifestMismatch,
            format!("{label} must be a GhostFlow name"),
        )
    }
}

fn normalize_capabilities(
    value: Vec<CapabilityWire>,
    label: &str,
    require_sorted: bool,
    limits: VerifierLimits,
) -> Result<Vec<Capability>> {
    if value.len() > limits.max_capabilities {
        return fail(
            ErrorCode::InvalidCapabilities,
            format!("{label} has too many capabilities"),
        );
    }
    let original = value
        .into_iter()
        .enumerate()
        .map(|(index, capability)| {
            require_identifier(&capability.kind, &format!("{label}[{index}].kind"))?;
            require_identifier(&capability.name, &format!("{label}[{index}].name"))?;
            if !matches!(capability.value_type.as_str(), "bool" | "number" | "int") {
                return fail(
                    ErrorCode::InvalidCapabilities,
                    format!("{label}[{index}].type must be bool, number or int"),
                );
            }
            Ok(Capability {
                kind: capability.kind,
                name: capability.name,
                value_type: capability.value_type,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    let mut sorted = original.clone();
    sorted.sort();
    if sorted.windows(2).any(|pair| pair[0] == pair[1]) {
        return fail(
            ErrorCode::DuplicateCapability,
            format!("{label} contains a duplicate capability"),
        );
    }
    if require_sorted && sorted != original {
        return fail(
            ErrorCode::NoncanonicalCapabilities,
            format!("{label} must be sorted by kind, name and type"),
        );
    }
    Ok(sorted)
}

fn canonical_json(value: &Value, limits: VerifierLimits) -> Result<Vec<u8>> {
    let mut output = Vec::new();
    write_canonical_json(value, &mut output, 0, limits)?;
    Ok(output)
}

fn write_canonical_json(
    value: &Value,
    output: &mut Vec<u8>,
    depth: usize,
    limits: VerifierLimits,
) -> Result<()> {
    if depth > limits.max_json_depth {
        return fail(
            ErrorCode::InvalidCanonicalJson,
            "canonical JSON nesting exceeds the configured limit",
        );
    }
    match value {
        Value::Null => output.extend_from_slice(b"null"),
        Value::Bool(true) => output.extend_from_slice(b"true"),
        Value::Bool(false) => output.extend_from_slice(b"false"),
        Value::String(text) => output.extend_from_slice(
            serde_json::to_string(text)
                .map_err(|_| PortablePackageError {
                    code: ErrorCode::InvalidCanonicalJson,
                    message: "cannot encode JSON string".into(),
                })?
                .as_bytes(),
        ),
        Value::Number(number) => {
            if let Some(integer) = number.as_i64() {
                if integer.unsigned_abs() > 9_007_199_254_740_991 {
                    return fail(
                        ErrorCode::InvalidCanonicalJson,
                        "canonical JSON rejects integers outside JavaScript's safe range",
                    );
                }
            } else if let Some(integer) = number.as_u64() {
                if integer > 9_007_199_254_740_991 {
                    return fail(
                        ErrorCode::InvalidCanonicalJson,
                        "canonical JSON rejects integers outside JavaScript's safe range",
                    );
                }
            } else if let Some(float) = number.as_f64() {
                if !float.is_finite()
                    || (float.fract() == 0.0 && float.abs() > 9_007_199_254_740_991.0)
                {
                    return fail(
                        ErrorCode::InvalidCanonicalJson,
                        "canonical JSON number is not representable by JavaScript",
                    );
                }
            }
            if let Some(float) = number
                .as_f64()
                .filter(|_| !number.is_i64() && !number.is_u64())
            {
                let mut buffer = ryu_js::Buffer::new();
                output.extend_from_slice(buffer.format_finite(float).as_bytes());
            } else {
                output.extend_from_slice(number.to_string().as_bytes());
            }
        }
        Value::Array(items) => {
            output.push(b'[');
            for (index, item) in items.iter().enumerate() {
                if index != 0 {
                    output.push(b',');
                }
                write_canonical_json(item, output, depth + 1, limits)?;
            }
            output.push(b']');
        }
        Value::Object(object) => {
            let mut keys = object.keys().collect::<Vec<_>>();
            keys.sort_by(|left, right| left.encode_utf16().cmp(right.encode_utf16()));
            output.push(b'{');
            for (index, key) in keys.into_iter().enumerate() {
                if index != 0 {
                    output.push(b',');
                }
                output.extend_from_slice(
                    serde_json::to_string(key)
                        .map_err(|_| PortablePackageError {
                            code: ErrorCode::InvalidCanonicalJson,
                            message: "cannot encode JSON key".into(),
                        })?
                        .as_bytes(),
                );
                output.push(b':');
                write_canonical_json(&object[key], output, depth + 1, limits)?;
            }
            output.push(b'}');
        }
    }
    Ok(())
}

fn parse_canonical_transport(bytes: &[u8], limits: VerifierLimits) -> Result<Value> {
    if bytes.len() > limits.max_transport_bytes {
        return fail(
            ErrorCode::PackageTooLarge,
            "portable package transport exceeds the configured limit",
        );
    }
    if bytes.is_empty() || !bytes.ends_with(b"\n") || bytes[..bytes.len() - 1].ends_with(b"\n") {
        return fail(
            ErrorCode::InvalidTransport,
            "portable package transport must end in exactly one newline",
        );
    }
    let json =
        std::str::from_utf8(&bytes[..bytes.len() - 1]).map_err(|_| PortablePackageError {
            code: ErrorCode::InvalidUtf8,
            message: "portable package transport is not UTF-8".into(),
        })?;
    let value: Value = serde_json::from_str(json).map_err(|error| PortablePackageError {
        code: ErrorCode::InvalidTransport,
        message: format!("portable package JSON is invalid: {error}"),
    })?;
    if canonical_json(&value, limits)? != bytes[..bytes.len() - 1] {
        return fail(
            ErrorCode::NoncanonicalJson,
            "portable package transport must use canonical JSON bytes",
        );
    }
    Ok(value)
}

fn decode_base64(value: &str, label: &str, maximum: usize) -> Result<Vec<u8>> {
    let maximum_encoded_len = maximum.saturating_add(2) / 3 * 4;
    if value.len() > maximum_encoded_len {
        return fail(
            ErrorCode::ArtifactTooLarge,
            format!("{label} exceeds the configured byte limit"),
        );
    }
    let bytes = BASE64.decode(value).map_err(|_| PortablePackageError {
        code: ErrorCode::InvalidBase64,
        message: format!("{label} must be canonical base64"),
    })?;
    if bytes.len() > maximum {
        return fail(
            ErrorCode::ArtifactTooLarge,
            format!("{label} exceeds the configured byte limit"),
        );
    }
    if BASE64.encode(&bytes) != value {
        return fail(
            ErrorCode::InvalidBase64,
            format!("{label} must use canonical base64 padding"),
        );
    }
    Ok(bytes)
}

fn validate_gfb1(bytes: &[u8]) -> Result<u16> {
    if bytes.len() < 6 || &bytes[..4] != b"GFB1" {
        return fail(ErrorCode::InvalidBytecodeFormat, "bytecode is not GFB1");
    }
    let version = u16::from_le_bytes([bytes[4], bytes[5]]);
    if !matches!(version, 1..=4 | 10 | 11) {
        return fail(
            ErrorCode::UnsupportedBytecodeVersion,
            "supported GFB format versions are 1, 2, 3, 4, 10 and 11",
        );
    }
    ghostflow_core::Module::load(bytes).map_err(|error| PortablePackageError {
        code: ErrorCode::BytecodeRejected,
        message: format!("native artifact validation failed: {error}"),
    })?;
    Ok(version)
}

fn manifest_capability_type(value: &str, label: &str) -> Result<&'static str> {
    match value {
        "Bool" => Ok("bool"),
        "Int" => Ok("int"),
        "Number" | "Percent" | "Duration" | "Date" | "TimeOfDay" | "DateTime" => Ok("number"),
        quantity if canonical_quantity_unit(quantity).is_some() => Ok("number"),
        _ => fail(
            ErrorCode::ManifestMismatch,
            format!("{label} is unsupported"),
        ),
    }
}

fn canonical_quantity_unit(value: &str) -> Option<&'static str> {
    Some(match value {
        "Temperature" => "K",
        "TemperatureDelta" => "ΔK",
        "RelativeHumidity" => "ratio",
        "Pressure" => "Pa",
        "VaporPressureDeficit" => "PaVPD",
        "CO2Concentration" => "molar ratio",
        "FlowRate" => "m3/s",
        "Volume" => "m3",
        "Length" => "m",
        "Irradiance" => "W/m2",
        "PPFD" => "mol/m2/s",
        "Energy" => "J",
        "Power" => "W",
        "ElectricalCurrent" => "A",
        "Voltage" => "V",
        "Conductivity" => "S/m",
        "Acidity" => "pH",
        _ => return None,
    })
}

fn manifest_canonical_unit(descriptor: &serde_json::Map<String, Value>, label: &str) -> Result<()> {
    let expected = descriptor
        .get("type")
        .and_then(Value::as_str)
        .and_then(canonical_quantity_unit);
    if let Some(expected) = expected {
        if descriptor.get("canonicalUnit").and_then(Value::as_str) != Some(expected) {
            return fail(
                ErrorCode::ManifestMismatch,
                format!("{label}.canonicalUnit must be {expected}"),
            );
        }
    } else if descriptor.contains_key("canonicalUnit") {
        return fail(
            ErrorCode::ManifestMismatch,
            format!("{label}.canonicalUnit is forbidden for non-quantity types"),
        );
    }
    Ok(())
}

fn value_object<'a>(value: &'a Value, label: &str) -> Result<&'a serde_json::Map<String, Value>> {
    value.as_object().ok_or_else(|| PortablePackageError {
        code: ErrorCode::ManifestMismatch,
        message: format!("{label} must be an object"),
    })
}

fn exact_keys(
    object: &serde_json::Map<String, Value>,
    expected: &[&str],
    label: &str,
    code: ErrorCode,
) -> Result<()> {
    let actual = object.keys().cloned().collect::<BTreeSet<_>>();
    let wanted = expected
        .iter()
        .map(|key| (*key).to_owned())
        .collect::<BTreeSet<_>>();
    if actual != wanted {
        return fail(
            code,
            format!("{label} must contain exactly: {}", expected.join(", ")),
        );
    }
    Ok(())
}

const DEBOUNCE_ROLES: [(&str, &str); 5] = [
    ("stable", "stable"),
    ("candidate", "candidate"),
    ("candidateActive", "candidate_active"),
    ("candidateSince", "candidate_since"),
    ("lastSourceTag", "last_source_tag"),
];
const DEBOUNCE_SOURCE_ROLES: [(&str, &str); 2] =
    [("lastEpoch", "source_epoch"), ("lastId", "source_id")];
const HOLD_LAST_ROLES: [(&str, &str); 11] = [
    ("available", "available"),
    ("value", "value"),
    ("heldSourceTag", "held_source_tag"),
    ("heldEpoch", "held_epoch"),
    ("heldId", "held_id"),
    ("heldTimestamp", "held_timestamp"),
    ("held", "held"),
    ("age", "age"),
    ("maskedFaultPresent", "masked_fault_present"),
    ("maskedFaultCode", "masked_fault_code"),
    ("maskedFaultOrigin", "masked_fault_origin"),
];
const SAMPLE_INPUTS: [(&str, &str); 4] = [
    ("samplePresentInput", "present"),
    ("sampleEpochInput", "epoch"),
    ("sampleIdInput", "id"),
    ("sampleTimestampInput", "timestamp"),
];

fn fault_members(name: &str) -> Option<&'static [&'static str]> {
    match name {
        "SensorFault" => Some(&["Disconnected", "Stale", "Invalid", "NotReady"]),
        "ClockFault" => Some(&["ClockUnknown", "ZoneUnsupported"]),
        "CalendarFault" => Some(&[
            "ClockUnknown",
            "CalendarMissing",
            "CalendarOutOfRange",
            "ZoneUnsupported",
        ]),
        "TemporalContextFault" => Some(&[
            "ClockUnknown",
            "LocationUnknown",
            "EventUnavailable",
            "PredictionMissing",
            "PredictionStale",
            "ZoneUnsupported",
        ]),
        _ => None,
    }
}

fn window_payload_type(descriptor: &Value) -> Result<ghostflow_core::Type> {
    use ghostflow_core::Type;
    let operation = descriptor["operation"].as_str().unwrap_or("");
    let payload = descriptor["payloadType"].as_str().unwrap_or("");
    let valid = match operation {
        "rate" => payload
            .strip_prefix("Rate<")
            .and_then(|value| value.strip_suffix('>'))
            .is_some_and(|quantity| {
                matches!(
                    quantity,
                    "Temperature"
                        | "TemperatureDelta"
                        | "Pressure"
                        | "VaporPressureDeficit"
                        | "FlowRate"
                        | "Volume"
                        | "Length"
                        | "Irradiance"
                        | "PPFD"
                        | "Energy"
                        | "Power"
                        | "ElectricalCurrent"
                        | "Voltage"
                        | "Conductivity"
                )
            }),
        "average" => {
            matches!(payload, "Number" | "Percent") || canonical_quantity_unit(payload).is_some()
        }
        "min" | "max" => {
            matches!(payload, "Int" | "Number" | "Percent")
                || canonical_quantity_unit(payload).is_some()
        }
        _ => false,
    };
    if !valid {
        return fail(
            ErrorCode::ManifestMismatch,
            "window operation/payload type is unsupported",
        );
    }
    Ok(if payload == "Int" {
        Type::Int
    } else {
        Type::Number
    })
}

fn verify_window_descriptor<'a>(
    signal: &'a Value,
    slot: usize,
    roots: &mut HashMap<&'a str, Option<u64>>,
    tags: &mut HashMap<u64, &'a str>,
) -> Result<()> {
    let descriptor = value_object(signal, "window signal")?;
    let mut fields = vec![
        "kind",
        "name",
        "site",
        "slot",
        "operation",
        "payloadType",
        "errorType",
        "quality",
        "overMs",
        "maxAgeMs",
        "clockInput",
        "timeEpochInput",
        "sources",
    ];
    if descriptor.contains_key("upstreamWindows") {
        fields.push("upstreamWindows");
    }
    exact_keys(
        descriptor,
        &fields,
        "window signal",
        ErrorCode::ManifestMismatch,
    )?;
    window_payload_type(signal)?;
    if descriptor["slot"].as_u64() != Some(slot as u64)
        || !descriptor["site"]
            .as_u64()
            .is_some_and(|value| value > 0 && value <= u32::MAX as u64)
        || descriptor["errorType"].as_str() != Some("SensorFault")
        || descriptor["quality"].as_str() != Some("measured")
        || descriptor["clockInput"].as_str() != Some("__gf_now_ms")
        || descriptor["timeEpochInput"].as_str() != Some("__gf_time_epoch")
    {
        return fail(
            ErrorCode::ManifestMismatch,
            "window slot/site/evidence/clock descriptor is invalid",
        );
    }
    for field in ["overMs", "maxAgeMs"] {
        if !descriptor[field]
            .as_u64()
            .is_some_and(|value| value > 0 && value <= 9_007_199_254_740_991)
        {
            return fail(
                ErrorCode::ManifestMismatch,
                "window duration must be an exact positive safe integer",
            );
        }
    }
    if let Some(dependencies) = descriptor.get("upstreamWindows") {
        let dependencies = dependencies
            .as_array()
            .filter(|entries| !entries.is_empty() && entries.len() <= slot)
            .ok_or_else(|| PortablePackageError {
                code: ErrorCode::ManifestMismatch,
                message: "window evidence dependencies must be a non-empty prior-window list"
                    .into(),
            })?;
        let mut previous = None;
        for dependency in dependencies {
            let dependency = value_object(dependency, "window evidence dependency")?;
            exact_keys(
                dependency,
                &["name", "site", "slot"],
                "window evidence dependency",
                ErrorCode::ManifestMismatch,
            )?;
            let position = dependency["slot"].as_u64();
            if !position.is_some_and(|position| {
                position < slot as u64 && previous.is_none_or(|prior| position > prior)
            }) || !dependency["site"]
                .as_u64()
                .is_some_and(|site| site > 0 && site <= u32::MAX as u64)
                || !dependency["name"]
                    .as_str()
                    .is_some_and(|name| !name.is_empty())
            {
                return fail(
                    ErrorCode::ManifestMismatch,
                    "invalid window evidence dependency",
                );
            }
            previous = position;
        }
    }
    let sources = descriptor["sources"]
        .as_array()
        .filter(|sources| !sources.is_empty() && sources.len() <= 128)
        .ok_or_else(|| PortablePackageError {
            code: ErrorCode::ManifestMismatch,
            message: "window sources must be a bounded non-empty array".into(),
        })?;
    let mut previous_tag = 0;
    let mut names = HashSet::new();
    for source in sources {
        let source = value_object(source, "window source")?;
        exact_keys(
            source,
            &["name", "tag"],
            "window source",
            ErrorCode::ManifestMismatch,
        )?;
        let name = source["name"].as_str().unwrap_or("");
        let tag = source["tag"].as_u64().unwrap_or(0);
        if tag <= previous_tag || tag > u32::MAX as u64 || !names.insert(name) {
            return fail(
                ErrorCode::ManifestMismatch,
                "window roots require unique names and ascending positive u32 tags",
            );
        }
        previous_tag = tag;
        let Some(root_tag) = roots.get_mut(name) else {
            return fail(
                ErrorCode::ManifestMismatch,
                "window root must name a sensor with sample inputs",
            );
        };
        if root_tag.is_some_and(|old| old != tag) || tags.get(&tag).is_some_and(|old| *old != name)
        {
            return fail(
                ErrorCode::ManifestMismatch,
                "window root tags must bind sensors consistently",
            );
        }
        *root_tag = Some(tag);
        tags.insert(tag, name);
    }
    Ok(())
}

fn verify_window_bindings(manifest: &Value, module: &ghostflow_core::Module) -> Result<()> {
    use ghostflow_core::temporal::Operation;
    let windows: Vec<_> = manifest["signals"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|signal| signal["kind"].as_str() == Some("window"))
        .collect();
    let Some(temporal) = module.temporal_requirements() else {
        return if windows.is_empty() {
            Ok(())
        } else {
            fail(
                ErrorCode::ManifestMismatch,
                "window manifest requires GFB format 4",
            )
        };
    };
    if windows.is_empty()
        && temporal
            .strategies
            .iter()
            .all(|strategy| strategy.windows.is_empty())
    {
        return Ok(());
    }
    if windows.is_empty() || manifest["format"].as_str() != Some("GhostFlow/control-v4") {
        return fail(
            ErrorCode::ManifestMismatch,
            "GFB format 4 requires a control-v4 window manifest",
        );
    }
    let inputs: Vec<_> = module.input_fields().collect();
    let mut used_roots = HashSet::new();
    // The current flat manifest describes the window layout for every strategy.
    for strategy in &temporal.strategies {
        if strategy.windows.len() != windows.len() {
            return fail(
                ErrorCode::ManifestMismatch,
                "manifest window count differs from bytecode",
            );
        }
        for (actual, expected) in strategy.windows.iter().zip(&windows) {
            let operation = match actual.operation {
                Operation::Average => "average",
                Operation::Min => "min",
                Operation::Max => "max",
                Operation::Rate => "rate",
            };
            if expected["name"].as_str() != Some(actual.name.as_str())
                || expected["site"].as_u64() != Some(u64::from(actual.site))
                || expected["operation"].as_str() != Some(operation)
                || window_payload_type(expected)? != actual.payload_type
                || expected["overMs"].as_u64() != Some(actual.over_ms)
                || expected["maxAgeMs"].as_u64() != Some(actual.max_age_ms)
            {
                return fail(
                    ErrorCode::ManifestMismatch,
                    "window descriptor differs from bytecode",
                );
            }
            let dependencies = expected.get("upstreamWindows").and_then(Value::as_array);
            if dependencies.map_or(0, Vec::len) != actual.upstream_windows.len() {
                return fail(
                    ErrorCode::ManifestMismatch,
                    "window evidence dependency count differs from bytecode",
                );
            }
            for (index, expected_dependency) in actual
                .upstream_windows
                .iter()
                .zip(dependencies.into_iter().flatten())
            {
                let upstream = &strategy.windows[usize::from(*index)];
                if expected_dependency["slot"].as_u64() != Some(u64::from(*index))
                    || expected_dependency["site"].as_u64() != Some(u64::from(upstream.site))
                    || expected_dependency["name"].as_str() != Some(upstream.name.as_str())
                {
                    return fail(
                        ErrorCode::ManifestMismatch,
                        "window evidence dependency differs from bytecode",
                    );
                }
            }
            let sources = expected["sources"].as_array().unwrap();
            if sources.len() != actual.roots.len() {
                return fail(
                    ErrorCode::ManifestMismatch,
                    "window source count differs from bytecode",
                );
            }
            for (index, expected_root) in actual.roots.iter().zip(sources) {
                let root = &temporal.roots[usize::from(*index)];
                if expected_root["name"].as_str() != Some(root.name.as_str())
                    || expected_root["tag"].as_u64() != Some(u64::from(root.source_tag))
                {
                    return fail(
                        ErrorCode::ManifestMismatch,
                        "window root binding differs from bytecode",
                    );
                }
                used_roots.insert(*index);
                let sensor = manifest["sensors"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|sensor| sensor["name"] == root.name)
                    .expect("window root sensor validated before binding comparison");
                for (field, input) in [
                    ("samplePresentInput", root.present_input),
                    ("sampleEpochInput", root.epoch_input),
                    ("sampleIdInput", root.id_input),
                    ("sampleTimestampInput", root.timestamp_input),
                ] {
                    if sensor[field].as_str() != Some(inputs[usize::from(input)].0) {
                        return fail(
                            ErrorCode::ManifestMismatch,
                            "window root sample input differs from bytecode",
                        );
                    }
                }
            }
        }
    }
    if used_roots.len() != temporal.roots.len() {
        return fail(
            ErrorCode::ManifestMismatch,
            "bytecode has undeclared window roots",
        );
    }
    Ok(())
}

fn verify_debounce_descriptors(
    manifest: &serde_json::Map<String, Value>,
    generated: &mut HashSet<String>,
) -> Result<()> {
    let sensors = manifest["sensors"].as_array().unwrap();
    let signals = manifest["signals"].as_array().unwrap();
    if sensors.len() > 128 || signals.len() > 128 {
        return fail(
            ErrorCode::ManifestMismatch,
            "signal descriptor count exceeds 128",
        );
    }
    let mut roots = HashMap::new();
    for sensor in sensors {
        let sensor = value_object(sensor, "sensor")?;
        let count = SAMPLE_INPUTS
            .iter()
            .filter(|(key, _)| sensor.contains_key(*key))
            .count();
        if count == 0 {
            continue;
        }
        if count != SAMPLE_INPUTS.len() {
            return fail(
                ErrorCode::ManifestMismatch,
                "sensor sample inputs must form a complete four-field group",
            );
        }
        let name =
            sensor
                .get("name")
                .and_then(Value::as_str)
                .ok_or_else(|| PortablePackageError {
                    code: ErrorCode::ManifestMismatch,
                    message: "sample sensor name must be a string".into(),
                })?;
        for (key, suffix) in SAMPLE_INPUTS {
            let expected = format!("__gf_sensor_sample_{suffix}_{name}");
            if sensor.get(key).and_then(Value::as_str) != Some(expected.as_str())
                || !generated.insert(expected)
            {
                return fail(
                    ErrorCode::ManifestMismatch,
                    format!("sensor {name}.{key} must be its unique generated sample input"),
                );
            }
        }
        if roots.insert(name, None::<u64>).is_some() {
            return fail(ErrorCode::ManifestMismatch, "duplicate sample sensor");
        }
    }
    let mut tags = HashMap::new();
    let mut private_states = HashSet::new();
    let mut signal_names = HashSet::new();
    let mut window_count = 0;
    let mut window_sites = HashSet::new();
    for signal in signals {
        let descriptor = value_object(signal, "signal")?;
        let name = descriptor.get("name").and_then(Value::as_str).unwrap_or("");
        require_ghost_name(name, "signal.name")?;
        if name.starts_with("__gf_") || !signal_names.insert(name) {
            return fail(
                ErrorCode::ManifestMismatch,
                "signal name must be unique and public",
            );
        }
        if !descriptor.contains_key("kind") {
            continue;
        }
        if descriptor["kind"].as_str() == Some("window") {
            verify_window_descriptor(signal, window_count, &mut roots, &mut tags)?;
            if !window_sites.insert(descriptor["site"].as_u64().unwrap()) {
                return fail(ErrorCode::ManifestMismatch, "duplicate window site");
            }
            window_count += 1;
            continue;
        }
        let hold = descriptor["kind"].as_str() == Some("hold-last");
        if !hold && descriptor["kind"].as_str() != Some("debounce") {
            return fail(
                ErrorCode::ManifestMismatch,
                "unsupported signal descriptor kind",
            );
        }
        let payload = descriptor
            .get("payloadType")
            .and_then(Value::as_str)
            .unwrap_or("");
        let prefix = if hold { "hold_last" } else { "debounce" };
        let roles: &[(&str, &str)] = if hold {
            &HOLD_LAST_ROLES
        } else {
            &DEBOUNCE_ROLES
        };
        let scalar = manifest_capability_type(payload, "payload").is_ok();
        let mut keys = vec![
            "kind",
            "name",
            "payloadType",
            "errorType",
            "sourceMode",
            "clockInput",
            "sources",
            "states",
        ];
        keys.extend(if hold {
            ["forAtMostMs", "quality"]
        } else {
            ["stableForMs", "initial"]
        });
        if !scalar {
            keys.push("members");
        }
        exact_keys(descriptor, &keys, prefix, ErrorCode::ManifestMismatch)?;
        if !hold && payload == "Bool" {
            if !descriptor["initial"].is_boolean() {
                return fail(
                    ErrorCode::ManifestMismatch,
                    "Bool debounce initial must be Bool",
                );
            }
        } else if !hold || !scalar {
            require_ghost_name(payload, "signal.payloadType")?;
            if manifest_capability_type(payload, "payload").is_ok()
                || payload == "Result"
                || payload.starts_with("__gf_")
            {
                return fail(
                    ErrorCode::ManifestMismatch,
                    if hold {
                        "hold-last payload must be a supported scalar or finite enum"
                    } else {
                        "debounce payload must be Bool or a finite enum"
                    },
                );
            }
            let members = descriptor["members"]
                .as_array()
                .ok_or_else(|| PortablePackageError {
                    code: ErrorCode::ManifestMismatch,
                    message: "signal members must be an array".into(),
                })?;
            let mut seen = HashSet::new();
            if members.is_empty() {
                return fail(ErrorCode::ManifestMismatch, "signal enum must be nonempty");
            }
            for member in members {
                let member = member.as_str().unwrap_or("");
                require_ghost_name(member, "signal enum member")?;
                if member.starts_with("__gf_") || !seen.insert(member) {
                    return fail(
                        ErrorCode::ManifestMismatch,
                        "signal enum members must be unique public names",
                    );
                }
            }
            if let Some(expected) = fault_members(payload) {
                if members
                    .iter()
                    .filter_map(Value::as_str)
                    .ne(expected.iter().copied())
                {
                    return fail(
                        ErrorCode::ManifestMismatch,
                        "signal built-in enum members do not match their type",
                    );
                }
            }
            if !hold
                && !descriptor["initial"].as_f64().is_some_and(|value| {
                    value.fract() == 0.0 && value >= 0.0 && value < members.len() as f64
                })
            {
                return fail(
                    ErrorCode::ManifestMismatch,
                    "debounce initial is outside its enum domain",
                );
            }
        }
        if hold
            && (descriptor["errorType"].as_str() != Some("SensorFault")
                || descriptor["quality"].as_str() != Some("measured"))
        {
            return fail(
                ErrorCode::ManifestMismatch,
                "hold-last requires SensorFault and measured quality",
            );
        }
        if !hold
            && !(descriptor["errorType"].is_null()
                || descriptor["errorType"]
                    .as_str()
                    .is_some_and(|name| fault_members(name).is_some()))
        {
            return fail(
                ErrorCode::ManifestMismatch,
                "debounce errorType must be null or a compiler fault enum",
            );
        }
        let duration = if hold { "forAtMostMs" } else { "stableForMs" };
        if !descriptor[duration].as_f64().is_some_and(|value| {
            value.fract() == 0.0 && (1.0..=9_007_199_254_740_991.0).contains(&value)
        }) {
            return fail(
                ErrorCode::ManifestMismatch,
                format!("{prefix} {duration} must be a positive safe integer Duration"),
            );
        }
        if descriptor["clockInput"].as_str() != Some("__gf_now_ms") {
            return fail(
                ErrorCode::ManifestMismatch,
                "temporal signal clockInput must be __gf_now_ms",
            );
        }
        let sources = descriptor["sources"]
            .as_array()
            .ok_or_else(|| PortablePackageError {
                code: ErrorCode::ManifestMismatch,
                message: "temporal signal sources must be an array".into(),
            })?;
        if sources.len() > 128
            || (hold && sources.is_empty())
            || descriptor["sourceMode"].as_str()
                != Some(if sources.is_empty() { "scan" } else { "sample" })
        {
            return fail(
                ErrorCode::ManifestMismatch,
                "temporal signal sourceMode must match its bounded source list",
            );
        }
        let mut previous_tag = 0;
        let mut source_names = HashSet::new();
        for source in sources {
            let source = value_object(source, "temporal signal source")?;
            exact_keys(
                source,
                &["name", "tag", "states"],
                "temporal signal source",
                ErrorCode::ManifestMismatch,
            )?;
            let source_name = source["name"].as_str().unwrap_or("");
            let tag = source["tag"].as_u64().unwrap_or(0);
            if tag <= previous_tag || tag > u32::MAX as u64 || !source_names.insert(source_name) {
                return fail(
                    ErrorCode::ManifestMismatch,
                    "temporal signal sources must have unique names and ascending positive u32 tags",
                );
            }
            previous_tag = tag;
            let Some(root_tag) = roots.get_mut(source_name) else {
                return fail(
                    ErrorCode::ManifestMismatch,
                    "temporal signal source must name a sensor with sample inputs",
                );
            };
            if root_tag.is_some_and(|old| old != tag)
                || tags.get(&tag).is_some_and(|old| *old != source_name)
            {
                return fail(
                    ErrorCode::ManifestMismatch,
                    "temporal signal source tags must bind roots consistently",
                );
            }
            *root_tag = Some(tag);
            tags.insert(tag, source_name);
            let source_states = value_object(&source["states"], "temporal signal source states")?;
            exact_keys(
                source_states,
                &DEBOUNCE_SOURCE_ROLES.map(|(role, _)| role),
                "temporal signal source states",
                ErrorCode::ManifestMismatch,
            )?;
            for (role, suffix) in DEBOUNCE_SOURCE_ROLES {
                let expected = format!("__gf_{prefix}_{suffix}_{name}_{tag}");
                if source_states[role].as_str() != Some(expected.as_str())
                    || !private_states.insert(expected.clone())
                    || generated.contains(&expected)
                {
                    return fail(
                        ErrorCode::ManifestMismatch,
                        format!("{prefix} source {role} must bind its unique generated state"),
                    );
                }
            }
        }
        let states = value_object(&descriptor["states"], "temporal signal states")?;
        exact_keys(
            states,
            &roles.iter().map(|(role, _)| *role).collect::<Vec<_>>(),
            "temporal signal states",
            ErrorCode::ManifestMismatch,
        )?;
        for &(role, suffix) in roles {
            let expected = format!("__gf_{prefix}_{suffix}_{name}");
            if states[role].as_str() != Some(expected.as_str())
                || !private_states.insert(expected.clone())
                || generated.contains(&expected)
            {
                return fail(
                    ErrorCode::ManifestMismatch,
                    format!("{prefix} {role} must bind its unique generated state"),
                );
            }
        }
    }
    if roots.values().any(Option::is_none) {
        return fail(
            ErrorCode::ManifestMismatch,
            "sensor sample inputs require a temporal signal consumer",
        );
    }
    if private_states.len() > 128 {
        return fail(
            ErrorCode::ManifestMismatch,
            "temporal signal generated resources exceed the 128 field profile",
        );
    }
    Ok(())
}

fn verify_config_bindings(manifest: &Value, module: &ghostflow_core::Module) -> Result<()> {
    use ghostflow_core::{
        schedule_vm::PulseDescriptor, settings_stream::ConfigValue, Value as MachineValue,
    };
    let mismatch = |message: &str| PortablePackageError {
        code: ErrorCode::ManifestMismatch,
        message: message.into(),
    };
    let temporal = module
        .temporal_requirements()
        .ok_or_else(|| mismatch("config streams require context clock bindings"))?;
    let schedules = module
        .schedule_requirements()
        .ok_or_else(|| mismatch("config streams require context descriptors"))?;
    if module.objective_requirements().is_some()
        || temporal.strategies.iter().any(|s| !s.windows.is_empty())
        || module
            .true_for_requirements()
            .is_some_and(|r| r.strategies.iter().any(|s| !s.signals.is_empty()))
        || !manifest["schedules"].as_array().unwrap().is_empty()
        || !manifest["signals"].as_array().unwrap().is_empty()
    {
        return Err(mismatch(
            "portable GFB11 profile supports config streams without schedule/objective preludes",
        ));
    }
    let configs = manifest["configs"].as_array().unwrap();
    if configs.is_empty() {
        return Err(mismatch("portable GFB11 profile requires config streams"));
    }
    let scalar_matches = |actual: MachineValue, expected: &Value| match actual {
        MachineValue::Bool(value) => expected.as_bool() == Some(value),
        MachineValue::Int(value) => expected.as_i64() == Some(i64::from(value)),
        MachineValue::Number(value) => expected.as_f64() == Some(value),
    };
    for strategy in &schedules.strategies {
        if strategy.schedules.len() != configs.len() {
            return Err(mismatch("manifest config count differs from bytecode"));
        }
        let mut ids = HashSet::new();
        for descriptor in &strategy.schedules {
            let PulseDescriptor::Config(config) = descriptor else {
                return Err(mismatch(
                    "portable context profile requires config-only preludes",
                ));
            };
            if config.kind == 3 {
                return Err(mismatch("portable config profile requires scalar payloads"));
            }
            let expected = configs
                .iter()
                .find(|entry| entry["id"].as_u64() == Some(u64::from(config.id)))
                .ok_or_else(|| mismatch("manifest config identity differs from bytecode"))?;
            if !ids.insert(config.id)
                || expected["name"].as_str() != Some(config.name.as_str())
                || expected["type"].as_str() != Some(config.semantic_type.as_str())
                || (expected["settings"]["access"].as_str() == Some("operator"))
                    != config.operator_editable
                || expected["settings"].get("apply").is_some()
            {
                return Err(mismatch("manifest config descriptor differs from bytecode"));
            }
            let ConfigValue::Scalar(initial) = config.initial else {
                return Err(mismatch("portable config profile requires scalar payloads"));
            };
            let initial_matches = scalar_matches(initial, &expected["value"]);
            let bounds_match = match config.bounds {
                Some((min, max, step)) => [("min", min), ("max", max), ("step", step)]
                    .iter()
                    .all(|(name, value)| scalar_matches(*value, &expected["settings"][*name])),
                None => ["min", "max", "step"]
                    .iter()
                    .all(|name| expected["settings"].get(*name).is_none()),
            };
            if !initial_matches || !bounds_match {
                return Err(mismatch(
                    "manifest config initial value or bounds differ from bytecode",
                ));
            }
        }
    }
    Ok(())
}

fn verify_debounce_bindings(manifest: &Value, bytecode: &[u8]) -> Result<()> {
    use ghostflow_core::{Module, Type, Value as MachineValue};
    let module = Module::load(bytecode).map_err(|error| PortablePackageError {
        code: ErrorCode::BytecodeRejected,
        message: format!("native artifact validation failed: {error}"),
    })?;
    if u16::from_le_bytes([bytecode[4], bytecode[5]]) == 11 {
        verify_config_bindings(manifest, &module)?;
    } else {
        verify_window_bindings(manifest, &module)?;
    }
    let inputs: HashMap<_, _> = module.input_fields().collect();
    let states: HashMap<_, _> = module
        .state_fields()
        .map(|(name, ty, value)| (name, (ty, value)))
        .collect();
    let mut expected_states = HashSet::new();
    let mut expected_samples = HashSet::new();
    for signal in manifest["signals"].as_array().unwrap() {
        let hold = signal["kind"].as_str() == Some("hold-last");
        if !hold && signal["kind"].as_str() != Some("debounce") {
            continue;
        }
        if inputs.get("__gf_now_ms") != Some(&Type::Number) {
            return fail(
                ErrorCode::ManifestMismatch,
                "temporal signal clock binding is missing or not Number",
            );
        }
        let payload = signal["payloadType"].as_str().unwrap();
        let initial = if hold {
            match payload {
                "Bool" => MachineValue::Bool(false),
                "Int" => MachineValue::Int(0),
                _ => MachineValue::Number(0.0),
            }
        } else if payload == "Bool" {
            MachineValue::Bool(signal["initial"].as_bool().unwrap())
        } else {
            MachineValue::Number(signal["initial"].as_f64().unwrap())
        };
        let roles: &[(&str, &str)] = if hold {
            &HOLD_LAST_ROLES
        } else {
            &DEBOUNCE_ROLES
        };
        for &(role, _) in roles {
            let name = signal["states"][role].as_str().unwrap();
            let default = match role {
                "stable" | "candidate" | "value" => initial,
                "candidateActive" | "available" | "held" | "maskedFaultPresent" => {
                    MachineValue::Bool(false)
                }
                "heldId" => MachineValue::Number(-1.0),
                "maskedFaultCode" => MachineValue::Number(3.0),
                _ => MachineValue::Number(0.0),
            };
            if states.get(name) != Some(&(default.value_type(), default)) {
                return fail(
                    ErrorCode::ManifestMismatch,
                    format!(
                        "temporal signal state {name} has a missing or mismatched bytecode type/default"
                    ),
                );
            }
            expected_states.insert(name);
        }
        for source in signal["sources"].as_array().unwrap() {
            for (role, _) in DEBOUNCE_SOURCE_ROLES {
                let name = source["states"][role].as_str().unwrap();
                let default = MachineValue::Number(if role == "lastId" { -1.0 } else { 0.0 });
                if states.get(name) != Some(&(Type::Number, default)) {
                    return fail(ErrorCode::ManifestMismatch, format!("temporal signal source state {name} has a missing or mismatched bytecode type/default"));
                }
                expected_states.insert(name);
            }
        }
    }
    for sensor in manifest["sensors"].as_array().unwrap() {
        for (key, _) in SAMPLE_INPUTS {
            if let Some(name) = sensor.get(key).and_then(Value::as_str) {
                let ty = if key == "samplePresentInput" {
                    Type::Bool
                } else {
                    Type::Number
                };
                if inputs.get(name) != Some(&ty) {
                    return fail(
                        ErrorCode::ManifestMismatch,
                        format!(
                            "sensor sample input {name} has a missing or mismatched bytecode type"
                        ),
                    );
                }
                expected_samples.insert(name);
            }
        }
    }
    if states.keys().any(|name| {
        (name.starts_with("__gf_debounce_") || name.starts_with("__gf_hold_last_"))
            && !expected_states.contains(name)
    }) || inputs
        .keys()
        .any(|name| name.starts_with("__gf_sensor_sample_") && !expected_samples.contains(name))
    {
        return fail(
            ErrorCode::ManifestMismatch,
            "bytecode contains undeclared temporal signal bindings",
        );
    }
    Ok(())
}

fn verify_gfb10_periodic_bindings(manifest: &Value, bytecode: &[u8]) -> Result<()> {
    use ghostflow_core::context_vm::ScheduleDefinition;
    use ghostflow_core::schedule_vm::PulseDescriptor;

    let module = ghostflow_core::Module::load(bytecode).map_err(|error| PortablePackageError {
        code: ErrorCode::BytecodeRejected,
        message: format!("native artifact validation failed: {error}"),
    })?;
    let mut encoded = HashMap::new();
    if let Some(requirements) = module.schedule_requirements() {
        for descriptor in requirements
            .strategies
            .iter()
            .flat_map(|strategy| &strategy.schedules)
        {
            let PulseDescriptor::Context(descriptor) = descriptor else {
                continue;
            };
            if !matches!(descriptor.definition, ScheduleDefinition::Periodic { .. }) {
                continue;
            }
            if encoded
                .insert(descriptor.site, descriptor)
                .is_some_and(|previous| previous != descriptor)
            {
                return fail(
                    ErrorCode::ManifestMismatch,
                    "GFB10 Periodic site has inconsistent strategy descriptors",
                );
            }
        }
    }

    let schedules = manifest["schedules"].as_array().unwrap();
    let periodic: Vec<_> = schedules
        .iter()
        .filter(|schedule| schedule["kind"].as_str() == Some("periodic"))
        .collect();
    if periodic.len() != encoded.len() {
        return fail(
            ErrorCode::ManifestMismatch,
            "GFB10 Periodic manifest count differs from bytecode",
        );
    }
    let configs = manifest["configs"].as_array().unwrap();
    for schedule in periodic {
        let object = value_object(schedule, "GFB10 Periodic schedule")?;
        exact_keys(
            object,
            &[
                "kind",
                "every",
                "anchor",
                "intervalChange",
                "site",
                "name",
                "policy",
            ],
            "GFB10 Periodic schedule",
            ErrorCode::ManifestMismatch,
        )?;
        let site = schedule["site"]
            .as_u64()
            .and_then(|site| u32::try_from(site).ok());
        let Some(actual) = site.and_then(|site| encoded.remove(&site)) else {
            return fail(
                ErrorCode::ManifestMismatch,
                "GFB10 Periodic site does not match bytecode",
            );
        };
        let ScheduleDefinition::Periodic {
            epoch_id,
            anchor_ms,
            every,
        } = &actual.definition
        else {
            unreachable!("Periodic descriptors were filtered above")
        };
        let anchor = value_object(&schedule["anchor"], "GFB10 Periodic anchor")?;
        let every_value = value_object(&schedule["every"], "GFB10 Periodic every")?;
        let policy = value_object(&schedule["policy"], "GFB10 Periodic policy")?;
        let expected_epoch = format!("instant:{anchor_ms}");
        if schedule.get("name").and_then(Value::as_str) != Some(actual.name.as_str())
            || schedule.get("intervalChange").and_then(Value::as_str) != Some("preserve_anchor")
            || policy.get("basis").and_then(Value::as_str) != Some("pulse")
            || policy.get("clock").and_then(Value::as_str) != Some("trusted_only")
            || policy.get("recovery").and_then(Value::as_str) != Some("baseline")
            || policy.get("fallback").and_then(Value::as_str) != Some("skip")
            || policy.get("gapMs").and_then(Value::as_u64) != Some(actual.gap_ms)
            || anchor.get("kind").and_then(Value::as_str) != Some("instant")
            || anchor.get("instantMs").and_then(Value::as_u64) != Some(*anchor_ms)
            || epoch_id != &expected_epoch
            || every_value.get("config").and_then(Value::as_str) != Some(every.name.as_str())
            || every_value.get("initialMs").and_then(Value::as_u64) != Some(every.initial_ms)
            || every_value.get("expression").and_then(Value::as_str)
                != Some(every.initial_ms.to_string().as_str())
        {
            return fail(
                ErrorCode::ManifestMismatch,
                "GFB10 Periodic descriptor does not match bytecode",
            );
        }
        let Some(config) = configs
            .iter()
            .find(|config| config["name"].as_str() == Some(every.name.as_str()))
        else {
            return fail(
                ErrorCode::ManifestMismatch,
                "GFB10 Periodic config is missing",
            );
        };
        let settings = config.get("settings").and_then(Value::as_object);
        let (min_ms, max_ms, step_ms, operator_editable) =
            settings.map_or((1, 9_007_199_254_740_991, 1, false), |settings| {
                (
                    settings.get("min").and_then(Value::as_u64).unwrap_or(0),
                    settings.get("max").and_then(Value::as_u64).unwrap_or(0),
                    settings.get("step").and_then(Value::as_u64).unwrap_or(0),
                    settings.get("access").and_then(Value::as_str) == Some("operator"),
                )
            });
        if config.get("type").and_then(Value::as_str) != Some("Duration")
            || config.get("value").and_then(Value::as_u64) != Some(every.initial_ms)
            || min_ms != every.min_ms
            || max_ms != every.max_ms
            || step_ms != every.step_ms
            || operator_editable != every.operator_editable
        {
            return fail(
                ErrorCode::ManifestMismatch,
                "GFB10 Periodic config does not match bytecode",
            );
        }
    }
    Ok(())
}

fn verify_manifest(
    manifest: &Value,
    descriptor_format: &str,
    bytecode_sha256: &str,
    identity: &[Capability],
) -> Result<()> {
    let object = value_object(manifest, "manifest")?;
    exact_keys(
        object,
        &[
            "format",
            "name",
            "inputs",
            "outputs",
            "sensors",
            "schedules",
            "timers",
            "signals",
            "configs",
            "bytecodeSha256",
        ],
        "manifest",
        ErrorCode::ManifestMismatch,
    )?;
    let format = object["format"]
        .as_str()
        .ok_or_else(|| PortablePackageError {
            code: ErrorCode::ManifestMismatch,
            message: "manifest.format must be a string".into(),
        })?;
    if format != descriptor_format {
        return fail(
            ErrorCode::ManifestMismatch,
            "manifest format does not match descriptor",
        );
    }
    require_ghost_name(
        object["name"]
            .as_str()
            .ok_or_else(|| PortablePackageError {
                code: ErrorCode::ManifestMismatch,
                message: "manifest.name must be a string".into(),
            })?,
        "manifest.name",
    )?;
    if object["bytecodeSha256"].as_str() != Some(bytecode_sha256) {
        return fail(
            ErrorCode::ManifestMismatch,
            "manifest bytecodeSha256 does not match GFB1",
        );
    }
    for field in [
        "inputs",
        "outputs",
        "sensors",
        "schedules",
        "timers",
        "signals",
        "configs",
    ] {
        if !object[field].is_array() {
            return fail(
                ErrorCode::ManifestMismatch,
                format!("manifest.{field} must be an array"),
            );
        }
    }
    // Existing timer clock inputs may be shared. New fault inputs must be
    // distinct from every public/generated input and from each other.
    let mut generated_names = HashSet::new();
    for (field, keys) in [
        ("inputs", &["name"][..]),
        ("sensors", &["valueInput", "okInput"][..]),
        ("signals", &["valueInput", "okInput"][..]),
        ("schedules", &["dueInput"][..]),
        ("timers", &["clockInput", "state"][..]),
    ] {
        for descriptor in object[field].as_array().unwrap() {
            for key in keys {
                if let Some(name) = descriptor.get(*key).and_then(Value::as_str) {
                    generated_names.insert(name.to_owned());
                }
            }
        }
    }
    for (field, prefix) in [("sensors", "sensor"), ("signals", "signal")] {
        for (index, descriptor) in object[field].as_array().unwrap().iter().enumerate() {
            if field == "signals"
                && matches!(
                    descriptor.get("kind").and_then(Value::as_str),
                    Some("debounce" | "hold-last" | "window")
                )
            {
                continue;
            }
            let label = format!("manifest.{field}[{index}]");
            let descriptor = value_object(descriptor, &label)?;
            let name = descriptor
                .get("name")
                .and_then(Value::as_str)
                .ok_or_else(|| PortablePackageError {
                    code: ErrorCode::ManifestMismatch,
                    message: format!("{label}.name must be a string"),
                })?;
            require_ghost_name(name, &format!("{label}.name"))?;
            let expected = format!("__gf_{prefix}_fault_{name}");
            if descriptor.get("faultInput").and_then(Value::as_str) != Some(expected.as_str())
                || !generated_names.insert(expected)
            {
                return fail(
                    ErrorCode::ManifestMismatch,
                    format!("{label}.faultInput must be its unique generated fault input"),
                );
            }
        }
    }
    verify_debounce_descriptors(object, &mut generated_names)?;
    let mut expected = BTreeSet::<Capability>::new();
    for (field, kind) in [("inputs", "input"), ("outputs", "actuator")] {
        let mut names = HashSet::new();
        let ports = object[field]
            .as_array()
            .ok_or_else(|| PortablePackageError {
                code: ErrorCode::ManifestMismatch,
                message: format!("manifest.{field} must be an array"),
            })?;
        for (index, port) in ports.iter().enumerate() {
            let port = value_object(port, &format!("manifest.{field}[{index}]"))?;
            let quantity = port
                .get("type")
                .and_then(Value::as_str)
                .and_then(canonical_quantity_unit)
                .is_some();
            exact_keys(
                port,
                if quantity {
                    &["name", "type", "canonicalUnit"]
                } else {
                    &["name", "type"]
                },
                &format!("manifest.{field}[{index}]"),
                ErrorCode::ManifestMismatch,
            )?;
            let name = port["name"].as_str().ok_or_else(|| PortablePackageError {
                code: ErrorCode::ManifestMismatch,
                message: format!("manifest.{field}[{index}].name must be a string"),
            })?;
            require_ghost_name(name, &format!("manifest.{field}[{index}].name"))?;
            if !names.insert(name.to_owned()) {
                return fail(
                    ErrorCode::ManifestMismatch,
                    format!("duplicate manifest {field} {name}"),
                );
            }
            let value_type = manifest_capability_type(
                port["type"].as_str().ok_or_else(|| PortablePackageError {
                    code: ErrorCode::ManifestMismatch,
                    message: format!("manifest.{field}[{index}].type must be a string"),
                })?,
                &format!("manifest.{field}[{index}].type"),
            )?;
            manifest_canonical_unit(port, &format!("manifest.{field}[{index}]"))?;
            expected.insert(Capability {
                kind: kind.into(),
                name: name.into(),
                value_type: value_type.into(),
            });
        }
    }
    let sensors = object["sensors"]
        .as_array()
        .ok_or_else(|| PortablePackageError {
            code: ErrorCode::ManifestMismatch,
            message: "manifest.sensors must be an array".into(),
        })?;
    for (index, sensor) in sensors.iter().enumerate() {
        let sensor = value_object(sensor, &format!("manifest.sensors[{index}]"))?;
        manifest_canonical_unit(sensor, &format!("manifest.sensors[{index}]"))?;
        let name =
            sensor
                .get("name")
                .and_then(Value::as_str)
                .ok_or_else(|| PortablePackageError {
                    code: ErrorCode::ManifestMismatch,
                    message: format!("manifest.sensors[{index}].name must be a string"),
                })?;
        let value_type =
            sensor
                .get("type")
                .and_then(Value::as_str)
                .ok_or_else(|| PortablePackageError {
                    code: ErrorCode::ManifestMismatch,
                    message: format!("manifest.sensors[{index}].type must be a string"),
                })?;
        require_ghost_name(name, &format!("manifest.sensors[{index}].name"))?;
        let value_type =
            manifest_capability_type(value_type, &format!("manifest.sensors[{index}].type"))?;
        if sensor.get("optional") != Some(&Value::Bool(true)) {
            expected.insert(Capability {
                kind: "sensor".into(),
                name: name.into(),
                value_type: value_type.into(),
            });
        }
    }
    for (index, config) in object["configs"].as_array().unwrap().iter().enumerate() {
        let label = format!("manifest.configs[{index}]");
        let config = value_object(config, &label)?;
        manifest_canonical_unit(config, &label)?;
        if config.get("type").and_then(Value::as_str) == Some("Int") {
            let integer = |value: Option<&Value>| -> Option<i64> {
                let value = value?.as_f64()?;
                (value.fract() == 0.0 && (-2147483648.0..=2147483647.0).contains(&value))
                    .then_some(value as i64)
            };
            let Some(value) = integer(config.get("value")) else {
                return fail(
                    ErrorCode::ManifestMismatch,
                    format!("{label}.value is outside the Int range"),
                );
            };
            if let Some(settings) = config.get("settings") {
                let settings = value_object(settings, &format!("{label}.settings"))?;
                let allowed = ["min", "max", "step", "access", "apply", "label"];
                if settings.keys().any(|key| !allowed.contains(&key.as_str()))
                    || !matches!(
                        settings.get("access").and_then(Value::as_str),
                        Some("operator" | "designer")
                    )
                    || settings
                        .get("apply")
                        .is_some_and(|value| value.as_str() != Some("stopped"))
                    || settings.get("label").is_some_and(|value| {
                        !value.as_str().is_some_and(|label| {
                            // Match the compiler/JS descriptor's UTF-16 length bound.
                            !label.is_empty() && label.encode_utf16().count() <= 128
                        })
                    })
                {
                    return fail(
                        ErrorCode::ManifestMismatch,
                        format!("{label}.settings has invalid Int metadata"),
                    );
                }
                let valid = match (
                    integer(settings.get("min")),
                    integer(settings.get("max")),
                    integer(settings.get("step")),
                ) {
                    (Some(min), Some(max), Some(step)) => {
                        // i64 retains the full 4294967295-wide i32 difference.
                        // A quotient tolerance would admit 1 on a MAX_INT grid.
                        min <= value
                            && value <= max
                            && step > 0
                            && (value - min) % step == 0
                            && (max - min) % step == 0
                    }
                    _ => false,
                };
                if !valid {
                    return fail(
                        ErrorCode::ManifestMismatch,
                        format!("{label}.settings does not match the Int range and exact step"),
                    );
                }
            }
        }
        let maximum = match config.get("type").and_then(Value::as_str) {
            Some("Date") => Some(2932896_f64),
            Some("TimeOfDay") => Some(86399999_f64),
            Some("DateTime") => Some(253402300799999_f64),
            _ => None,
        };
        if let Some(maximum) = maximum {
            let in_range = |value: f64| {
                value.is_finite() && value.fract() == 0.0 && (0.0..=maximum).contains(&value)
            };
            let value = config.get("value").and_then(Value::as_f64);
            if !value.is_some_and(in_range) {
                return fail(
                    ErrorCode::ManifestMismatch,
                    format!("{label}.value is outside its time type range"),
                );
            }
            if let Some(settings) = config.get("settings") {
                let settings = value_object(settings, &format!("{label}.settings"))?;
                let date = config.get("type").and_then(Value::as_str) == Some("Date");
                let step_type = if date { "Int" } else { "Duration" };
                let step_maximum = if date {
                    2147483647_f64
                } else {
                    9007199254740991_f64
                };
                let min = settings.get("min").and_then(Value::as_f64);
                let max = settings.get("max").and_then(Value::as_f64);
                let step = settings.get("step").and_then(Value::as_f64);
                let valid = match (min, max, step) {
                    (Some(min), Some(max), Some(step)) => {
                        in_range(min)
                            && in_range(max)
                            && min <= value.unwrap()
                            && value.unwrap() <= max
                            && step.is_finite()
                            && step.fract() == 0.0
                            && step > 0.0
                            && step <= step_maximum
                            && (value.unwrap() - min) % step == 0.0
                            && (max - min) % step == 0.0
                            && settings.get("stepType").and_then(Value::as_str) == Some(step_type)
                    }
                    _ => false,
                };
                if !valid {
                    return fail(
                        ErrorCode::ManifestMismatch,
                        format!("{label}.settings does not match its time type range and step"),
                    );
                }
            }
        }
    }
    let actual = identity.iter().cloned().collect::<BTreeSet<_>>();
    if expected != actual {
        return fail(
            ErrorCode::CapabilityManifestMismatch,
            "manifest inputs, required sensors, outputs and signed capabilities must match exactly",
        );
    }
    Ok(())
}

fn verify_source_map(
    source_map: &Value,
    source: &SourceWire,
    source_text: &str,
    source_sha256: &str,
    bytecode_sha256: &str,
) -> Result<()> {
    let object = value_object(source_map, "sourceMap")?;
    exact_keys(
        object,
        &[
            "format",
            "bytecodeSha256",
            "sourceDocument",
            "nodes",
            "lines",
            "traceMetadata",
        ],
        "sourceMap",
        ErrorCode::SourceMapMismatch,
    )?;
    if object["format"].as_str() != Some(SOURCE_MAP_FORMAT)
        || object["bytecodeSha256"].as_str() != Some(bytecode_sha256)
    {
        return fail(
            ErrorCode::SourceMapMismatch,
            "source map format or GFB1 digest does not match package",
        );
    }
    let document = value_object(&object["sourceDocument"], "sourceMap.sourceDocument")?;
    exact_keys(
        document,
        &["format", "kind", "filename", "text", "sha256"],
        "sourceMap.sourceDocument",
        ErrorCode::SourceMapMismatch,
    )?;
    if document["format"].as_str() != Some(SOURCE_FORMAT)
        || document["kind"].as_str() != Some("literate")
        || document["filename"].as_str() != Some(source.filename.as_str())
        || document["sha256"].as_str() != Some(source_sha256)
        || document["text"].as_str() != Some(source_text)
    {
        return fail(
            ErrorCode::SourceMapMismatch,
            "source map document does not match the authoritative literate source",
        );
    }
    if !object["nodes"].is_array() || !(object["lines"].is_null() || object["lines"].is_array()) {
        return fail(
            ErrorCode::SourceMapMismatch,
            "source map nodes/lines have an unsupported shape",
        );
    }
    Ok(())
}

fn require_profile_identifier(value: &str, label: &str) -> Result<()> {
    require_identifier(value, label)
}

fn validate_supported_profile(values: &[String], label: &str) -> Result<()> {
    if values.is_empty() {
        return fail(
            ErrorCode::InvalidVerifierOptions,
            format!("{label} must be a non-empty array"),
        );
    }
    for (index, value) in values.iter().enumerate() {
        require_identifier(value, &format!("{label}[{index}]"))?;
    }
    Ok(())
}

/// Verify exact canonical package transport bytes and return detached artifacts.
///
/// This first native slice checks source-map envelope and source linkage. Deep
/// compiler-owned trace metadata semantics remain the responsibility of the
/// existing common verifier that the trusted package signer invokes during its
/// deterministic build replay.
pub fn verify_portable_package(
    transport: &[u8],
    profile: &VerificationProfile<'_>,
) -> Result<VerifiedPackage> {
    verify_portable_package_with_signature_policy(transport, profile, SignaturePolicy::Enforce)
}

/// Development opt-out affects publisher authentication only. All package,
/// compatibility and target-loader checks use the same verifier as strict mode.
pub fn verify_portable_package_with_signature_policy(
    transport: &[u8],
    profile: &VerificationProfile<'_>,
    signature_policy: SignaturePolicy,
) -> Result<VerifiedPackage> {
    let root = parse_canonical_transport(transport, profile.limits)?;
    let envelope: Envelope = parse_wire(root, "package")?;
    if envelope.format != PACKAGE_FORMAT {
        return fail(
            ErrorCode::UnsupportedPackageFormat,
            "package format is unsupported",
        );
    }
    require_digest(&envelope.payload_sha256, "package.payloadSha256")?;
    if (signature_policy == SignaturePolicy::Enforce && envelope.signatures.is_empty())
        || envelope.signatures.len() > profile.limits.max_signatures
    {
        return fail(
            ErrorCode::SignatureCount,
            "package signatures must contain 1 to the configured maximum",
        );
    }
    let payload_bytes = canonical_json(&envelope.payload, profile.limits)?;
    if payload_bytes.len() > profile.limits.max_signed_payload_bytes {
        return fail(
            ErrorCode::PackageTooLarge,
            "signed payload exceeds the configured limit",
        );
    }
    if sha256_hex(&payload_bytes) != envelope.payload_sha256 {
        return fail(
            ErrorCode::DigestMismatch,
            "package payload SHA-256 does not match canonical payload bytes",
        );
    }
    let payload: PayloadWire = parse_wire(envelope.payload, "payload")?;
    if payload.format != PAYLOAD_FORMAT {
        return fail(
            ErrorCode::UnsupportedPayloadFormat,
            "payload format is unsupported",
        );
    }

    let identity = PackageIdentity {
        compiler_revision: payload.identity.compiler_revision,
        runtime_semantics: payload.identity.runtime_semantics,
        runtime_abi: payload.identity.runtime_abi,
        required_capabilities: normalize_capabilities(
            payload.identity.required_capabilities,
            "identity.requiredCapabilities",
            true,
            profile.limits,
        )?,
        binding_revision: payload.identity.binding_revision,
    };
    require_profile_identifier(&identity.compiler_revision, "identity.compilerRevision")?;
    require_profile_identifier(&identity.runtime_semantics, "identity.runtimeSemantics")?;
    require_profile_identifier(&identity.runtime_abi, "identity.runtimeAbi")?;
    require_profile_identifier(&identity.binding_revision, "identity.bindingRevision")?;

    let accepted_key_ids = match signature_policy {
        SignaturePolicy::Enforce => {
            verify_signatures(&envelope.signatures, &payload_bytes, profile)?
        }
        SignaturePolicy::DevelopmentBypass => {
            let mut seen = HashSet::new();
            for signature in &envelope.signatures {
                if signature_bytes(signature, &mut seen)?.len() != 64 {
                    return fail(
                        ErrorCode::InvalidSchema,
                        "Ed25519 signature must be 64 bytes",
                    );
                }
            }
            Vec::new()
        }
    };
    require_identifier(
        profile.expected_compiler_revision,
        "expectedCompilerRevision",
    )?;
    validate_supported_profile(
        profile.supported_runtime_semantics,
        "supportedRuntimeSemantics",
    )?;
    validate_supported_profile(profile.supported_runtime_abis, "supportedRuntimeAbis")?;
    require_identifier(profile.expected_binding_revision, "expectedBindingRevision")?;
    validate_supported_profile(
        profile.supported_manifest_formats,
        "supportedManifestFormats",
    )?;
    if identity.compiler_revision != profile.expected_compiler_revision {
        return fail(
            ErrorCode::CompilerRevisionMismatch,
            "package compiler revision does not match selected compiler release",
        );
    }
    if !profile
        .supported_runtime_semantics
        .iter()
        .any(|item| item == &identity.runtime_semantics)
    {
        return fail(
            ErrorCode::UnsupportedRuntimeSemantics,
            "package runtime semantics are unsupported",
        );
    }
    if !profile
        .supported_runtime_abis
        .iter()
        .any(|item| item == &identity.runtime_abi)
    {
        return fail(
            ErrorCode::UnsupportedRuntimeAbi,
            "package runtime ABI is unsupported",
        );
    }
    if identity.binding_revision != profile.expected_binding_revision {
        return fail(
            ErrorCode::BindingRevisionMismatch,
            "package binding revision does not match installation binding",
        );
    }
    if !profile
        .supported_manifest_formats
        .iter()
        .any(|item| item == &payload.manifest.format)
    {
        return fail(
            ErrorCode::UnsupportedManifestFormat,
            "package manifest format is unsupported",
        );
    }
    let available = normalize_capabilities(
        profile
            .available_capabilities
            .iter()
            .map(|capability| CapabilityWire {
                kind: capability.kind.clone(),
                name: capability.name.clone(),
                value_type: capability.value_type.clone(),
            })
            .collect(),
        "availableCapabilities",
        false,
        profile.limits,
    )?;
    let available = available.into_iter().collect::<BTreeSet<_>>();
    if let Some(missing) = identity
        .required_capabilities
        .iter()
        .find(|capability| !available.contains(*capability))
    {
        return fail(
            ErrorCode::MissingCapability,
            format!(
                "missing required capability {}:{}:{}",
                missing.kind, missing.name, missing.value_type
            ),
        );
    }

    verify_descriptor(
        &payload.source.format,
        SOURCE_FORMAT,
        ErrorCode::NoncanonicalSource,
        "payload source format",
    )?;
    if payload.source.kind != "literate" || payload.source.media_type != SOURCE_MEDIA_TYPE {
        return fail(
            ErrorCode::NoncanonicalSource,
            "payload source must be GhostFlow literate Markdown",
        );
    }
    require_source_filename(&payload.source.filename, "payload.source.filename")?;
    require_digest(&payload.source.sha256, "payload.source.sha256")?;
    if payload.bytecode.format != "GFB1" {
        return fail(
            ErrorCode::InvalidBytecodeFormat,
            "payload bytecode format must be GFB1",
        );
    }
    if !matches!(
        payload.bytecode.version.as_str(),
        "1" | "2" | "3" | "4" | "10" | "11"
    ) {
        return fail(
            ErrorCode::UnsupportedBytecodeVersion,
            "payload bytecode version must be 1, 2, 3, 4, 10 or 11",
        );
    }
    require_digest(&payload.bytecode.sha256, "payload.bytecode.sha256")?;
    require_identifier(&payload.manifest.format, "payload.manifest.format")?;
    require_digest(&payload.manifest.sha256, "payload.manifest.sha256")?;
    if payload.source_map.format != SOURCE_MAP_FORMAT {
        return fail(
            ErrorCode::UnsupportedSourceMapFormat,
            "payload source map format is unsupported",
        );
    }
    require_digest(&payload.source_map.sha256, "payload.sourceMap.sha256")?;

    let source_bytes = decode_base64(
        &payload.source.content_base64,
        "payload.source.contentBase64",
        profile.limits.max_artifact_bytes,
    )?;
    let bytecode = decode_base64(
        &payload.bytecode.content_base64,
        "payload.bytecode.contentBase64",
        profile.limits.max_artifact_bytes,
    )?;
    let manifest_bytes = decode_base64(
        &payload.manifest.content_base64,
        "payload.manifest.contentBase64",
        profile.limits.max_artifact_bytes,
    )?;
    let source_map_bytes = decode_base64(
        &payload.source_map.content_base64,
        "payload.sourceMap.contentBase64",
        profile.limits.max_artifact_bytes,
    )?;
    let source_sha256 = sha256_hex(&source_bytes);
    let bytecode_sha256 = sha256_hex(&bytecode);
    if source_sha256 != payload.source.sha256 {
        return fail(
            ErrorCode::SourceDigestMismatch,
            "source SHA-256 does not match content",
        );
    }
    if bytecode_sha256 != payload.bytecode.sha256 {
        return fail(
            ErrorCode::BytecodeDigestMismatch,
            "GFB1 SHA-256 does not match content",
        );
    }
    if sha256_hex(&manifest_bytes) != payload.manifest.sha256 {
        return fail(
            ErrorCode::ManifestDigestMismatch,
            "manifest SHA-256 does not match content",
        );
    }
    if sha256_hex(&source_map_bytes) != payload.source_map.sha256 {
        return fail(
            ErrorCode::SourceMapDigestMismatch,
            "source map SHA-256 does not match content",
        );
    }
    let bytecode_version = validate_gfb1(&bytecode)?;
    if bytecode_version.to_string() != payload.bytecode.version {
        return fail(
            ErrorCode::BytecodeVersionMismatch,
            "payload bytecode version does not match its GFB header",
        );
    }
    if (payload.bytecode.version == "11") != (payload.manifest.format == "GhostFlow/control-v10")
        || (payload.bytecode.version == "11")
            != (identity.runtime_abi == "GhostFlow/context-scan-abi-v5")
    {
        return fail(
            ErrorCode::ManifestMismatch,
            "GFB11 requires control-v10 and context-scan-abi-v5",
        );
    }
    let source_text = String::from_utf8(source_bytes).map_err(|_| PortablePackageError {
        code: ErrorCode::InvalidUtf8,
        message: "source must be well-formed UTF-8".into(),
    })?;
    let manifest = parse_embedded_canonical_json(&manifest_bytes, "manifest", profile.limits)?;
    let source_map = parse_embedded_canonical_json(&source_map_bytes, "sourceMap", profile.limits)?;
    if bytecode_version == 10 && manifest["format"].as_str() != Some("GhostFlow/control-v9") {
        return fail(
            ErrorCode::ManifestMismatch,
            "GFB format 10 requires a control-v9 manifest",
        );
    }
    verify_manifest(
        &manifest,
        &payload.manifest.format,
        &bytecode_sha256,
        &identity.required_capabilities,
    )?;
    verify_debounce_bindings(&manifest, &bytecode)?;
    if bytecode_version == 10 {
        verify_gfb10_periodic_bindings(&manifest, &bytecode)?;
    }
    verify_source_map(
        &source_map,
        &payload.source,
        &source_text,
        &source_sha256,
        &bytecode_sha256,
    )?;
    let context = TargetLoaderContext {
        manifest: &manifest,
        source_map: &source_map,
        identity: &identity,
    };
    let loader_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        profile.target_loader.accept(&bytecode, &context)
    }));
    match loader_result {
        Err(_) => {
            return fail(
                ErrorCode::BytecodeRejected,
                "target GFB1 loader panicked while validating the package",
            )
        }
        Ok(Ok(true)) => {}
        Ok(Ok(false)) => {
            return fail(
                ErrorCode::BytecodeRejected,
                "target GFB1 loader did not explicitly accept the package",
            )
        }
        Ok(Err(error)) => {
            return fail(
                ErrorCode::BytecodeRejected,
                format!("target GFB1 loader rejected the package: {error}"),
            )
        }
    }
    Ok(VerifiedPackage {
        package_format: PACKAGE_FORMAT,
        payload_sha256: envelope.payload_sha256,
        accepted_key_ids,
        signature_authentication: match signature_policy {
            SignaturePolicy::Enforce => SignatureAuthentication::Authenticated,
            SignaturePolicy::DevelopmentBypass => SignatureAuthentication::DevelopmentBypass,
        },
        source: VerifiedSource {
            filename: payload.source.filename,
            text: source_text,
            sha256: source_sha256,
        },
        manifest,
        source_map,
        identity,
        bytecode,
        bytecode_sha256,
    })
}

fn verify_descriptor(actual: &str, expected: &str, code: ErrorCode, label: &str) -> Result<()> {
    if actual == expected {
        Ok(())
    } else {
        fail(code, format!("{label} is unsupported"))
    }
}

fn parse_embedded_canonical_json(
    bytes: &[u8],
    label: &str,
    limits: VerifierLimits,
) -> Result<Value> {
    let text = std::str::from_utf8(bytes).map_err(|_| PortablePackageError {
        code: ErrorCode::InvalidUtf8,
        message: format!("{label} must be well-formed UTF-8"),
    })?;
    let value: Value = serde_json::from_str(text).map_err(|error| PortablePackageError {
        code: ErrorCode::InvalidCanonicalJson,
        message: format!("{label} is not valid JSON: {error}"),
    })?;
    if canonical_json(&value, limits)? != bytes {
        return fail(
            ErrorCode::NoncanonicalJson,
            format!("{label} must contain canonical JSON bytes"),
        );
    }
    Ok(value)
}

fn signature_bytes<'a>(
    signature: &'a SignatureWire,
    seen: &mut HashSet<&'a str>,
) -> Result<Vec<u8>> {
    if signature.algorithm != "Ed25519" {
        return fail(
            ErrorCode::UnsupportedSignatureAlgorithm,
            "only Ed25519 signatures are supported",
        );
    }
    require_identifier(&signature.key_id, "signatures.keyId")?;
    if !seen.insert(signature.key_id.as_str()) {
        return fail(ErrorCode::DuplicateSignature, "duplicate signature key ID");
    }
    decode_base64(
        &signature.signature_base64,
        "signatures.signatureBase64",
        256,
    )
}

fn verify_signatures(
    signatures: &[SignatureWire],
    payload_bytes: &[u8],
    profile: &VerificationProfile<'_>,
) -> Result<Vec<String>> {
    if profile.trusted_keys.is_empty() {
        return fail(
            ErrorCode::InvalidTrustStore,
            "trustedKeys must not be empty",
        );
    }
    let mut trusted = HashMap::new();
    for key in profile.trusted_keys {
        require_identifier(&key.key_id, "trustedKeys.keyId")?;
        let verifying_key =
            VerifyingKey::from_bytes(&key.public_key).map_err(|_| PortablePackageError {
                code: ErrorCode::InvalidTrustStore,
                message: format!("trusted key {} is invalid Ed25519 data", key.key_id),
            })?;
        if trusted.insert(key.key_id.as_str(), verifying_key).is_some() {
            return fail(
                ErrorCode::InvalidTrustStore,
                "trustedKeys contains a duplicate key ID",
            );
        }
    }
    let mut revoked = HashSet::new();
    for key_id in profile.revoked_key_ids {
        require_identifier(key_id, "revokedKeyIds")?;
        revoked.insert(key_id.as_str());
    }
    let mut seen = HashSet::new();
    let mut accepted = Vec::new();
    let mut saw_revoked = false;
    for signature in signatures {
        let signature_bytes = signature_bytes(signature, &mut seen)?;
        if revoked.contains(signature.key_id.as_str()) {
            saw_revoked = true;
            continue;
        }
        let Some(key) = trusted.get(signature.key_id.as_str()) else {
            continue;
        };
        let Ok(parsed_signature) = Signature::from_slice(&signature_bytes) else {
            continue;
        };
        if key.verify(payload_bytes, &parsed_signature).is_ok() {
            accepted.push(signature.key_id.clone());
        }
    }
    if accepted.is_empty() {
        if saw_revoked {
            return fail(
                ErrorCode::SigningKeyRevoked,
                "no active trusted signature remains after revocation",
            );
        }
        return fail(
            ErrorCode::UntrustedSignature,
            "no active trusted signature verifies the payload",
        );
    }
    accepted.sort();
    Ok(accepted)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn fixture_for(scenario: &str) -> Vec<u8> {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let output = Command::new("node")
            .arg(root.join("tests/native-portable-package-fixture.mjs"))
            .arg(scenario)
            .current_dir(&root)
            .output()
            .expect("Node must generate the portable-package fixture");
        assert!(
            output.status.success(),
            "fixture generation failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        output.stdout
    }

    fn fixture() -> Vec<u8> {
        fixture_for("valid")
    }

    fn public_key() -> [u8; 32] {
        [
            0xd7, 0x5a, 0x98, 0x01, 0x82, 0xb1, 0x0a, 0xb7, 0xd5, 0x4b, 0xfe, 0xd3, 0xc9, 0x64,
            0x07, 0x3a, 0x0e, 0xe1, 0x72, 0xf3, 0xda, 0xa6, 0x23, 0x25, 0xaf, 0x02, 0x1a, 0x68,
            0xf7, 0x07, 0x51, 0x1a,
        ]
    }

    fn strings(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).into()).collect()
    }
    fn capabilities() -> Vec<Capability> {
        vec![
            Capability {
                kind: "actuator".into(),
                name: "pump".into(),
                value_type: "bool".into(),
            },
            Capability {
                kind: "actuator".into(),
                name: "valve".into(),
                value_type: "bool".into(),
            },
            Capability {
                kind: "input".into(),
                name: "start".into(),
                value_type: "bool".into(),
            },
            Capability {
                kind: "input".into(),
                name: "stop".into(),
                value_type: "bool".into(),
            },
        ]
    }

    fn profile<'a>(loader: &'a dyn TargetLoader) -> VerificationProfile<'a> {
        let keys = Box::leak(Box::new(vec![TrustedKey {
            key_id: "test-current-2026".into(),
            public_key: public_key(),
        }]));
        let revoked = Box::leak(Box::new(Vec::new()));
        let semantics = Box::leak(Box::new(strings(&["GhostFlow/runtime-semantics-v1"])));
        let abis = Box::leak(Box::new(strings(&[
            "GhostFlow/framed-scan-abi-v1",
            "GhostFlow/context-scan-abi-v5",
        ])));
        let manifests = Box::leak(Box::new(strings(&[
            "GhostFlow/control-v1",
            "GhostFlow/control-v10",
        ])));
        let capabilities = Box::leak(Box::new(capabilities()));
        VerificationProfile {
            trusted_keys: keys,
            revoked_key_ids: revoked,
            expected_compiler_revision: "c0bef0e",
            supported_runtime_semantics: semantics,
            supported_runtime_abis: abis,
            supported_manifest_formats: manifests,
            available_capabilities: capabilities,
            expected_binding_revision: "virtual-two-output-v1",
            target_loader: loader,
            limits: VerifierLimits::default(),
        }
    }

    #[test]
    fn signed_window_package_binds_gfb4_and_executes_in_the_native_core() {
        use ghostflow_core::{
            temporal::{RootDensity, TargetBudget},
            temporal_runtime::TemporalActivation,
            Module, Runtime, Type, Value as MachineValue,
        };
        let loader =
            |bytes: &[u8], _: &TargetLoaderContext<'_>| -> std::result::Result<bool, String> {
                Module::load(bytes)
                    .map(|_| true)
                    .map_err(|error| error.to_string())
            };
        let capabilities = vec![
            Capability {
                kind: "actuator".into(),
                name: "pump".into(),
                value_type: "bool".into(),
            },
            Capability {
                kind: "sensor".into(),
                name: "probe".into(),
                value_type: "number".into(),
            },
        ];
        let formats = strings(&["GhostFlow/control-v4"]);
        let mut current = profile(&loader);
        current.available_capabilities = &capabilities;
        current.supported_manifest_formats = &formats;
        let verified = verify_portable_package(&fixture_for("window-valid"), &current).unwrap();
        let module = Module::load(&verified.bytecode_copy()).unwrap();
        let root = module.temporal_requirements().unwrap().roots[0].source_tag;
        let mut runtime = Runtime::new(2);
        runtime.install(module, false);
        runtime
            .add_capability(ghostflow_core::Capability::new(
                "actuator",
                "pump",
                Type::Bool,
            ))
            .unwrap();
        runtime
            .activate_with_temporal(&TemporalActivation {
                root_density: vec![RootDensity {
                    source_tag: root,
                    max_observations: 3,
                    interval_ms: 1000,
                }],
                budget: TargetBudget {
                    max_retained_samples: 12,
                    max_bytes: 1_000_000,
                },
                time_epoch: 5,
            })
            .unwrap();
        let sensor = &verified.manifest["sensors"][0];
        for (id, now, value, expected) in [(1, 1000, 280.0, false), (2, 1400, 284.0, true)] {
            for (key, value) in [
                ("valueInput", MachineValue::Number(value)),
                ("okInput", MachineValue::Bool(true)),
                ("faultInput", MachineValue::Number(0.0)),
                ("samplePresentInput", MachineValue::Bool(true)),
                ("sampleEpochInput", MachineValue::Number(1.0)),
                ("sampleIdInput", MachineValue::Number(id as f64)),
                ("sampleTimestampInput", MachineValue::Number(now as f64)),
            ] {
                runtime
                    .set_input(sensor[key].as_str().unwrap(), value)
                    .unwrap();
            }
            runtime
                .set_input("__gf_time_epoch", MachineValue::Number(5.0))
                .unwrap();
            let trace = runtime.tick_at(now).unwrap();
            assert_eq!(trace.safe_intents["pump"], MachineValue::Bool(expected));
            if id == 2 {
                assert_eq!(
                    trace
                        .window_trace
                        .iter()
                        .map(|entry| entry.outcome.value)
                        .collect::<Vec<_>>(),
                    vec![Some(282.0), Some(280.0), Some(284.0), Some(10.0)]
                );
            }
        }
    }

    #[test]
    fn signed_window_manifest_substitutions_fail_before_native_loader() {
        let called = std::cell::Cell::new(false);
        let loader = |_: &[u8], _: &TargetLoaderContext<'_>| -> std::result::Result<bool, String> {
            called.set(true);
            Ok(true)
        };
        let capabilities = vec![
            Capability {
                kind: "actuator".into(),
                name: "pump".into(),
                value_type: "bool".into(),
            },
            Capability {
                kind: "sensor".into(),
                name: "probe".into(),
                value_type: "number".into(),
            },
        ];
        let formats = strings(&["GhostFlow/control-v1", "GhostFlow/control-v4"]);
        let mut current = profile(&loader);
        current.available_capabilities = &capabilities;
        current.supported_manifest_formats = &formats;
        for scenario in [
            "window-zero-duration",
            "window-duration-mismatch",
            "window-operation-mismatch",
            "window-slot-mismatch",
            "window-site-mismatch",
            "window-payload-mismatch",
            "window-source-tag-mismatch",
            "window-missing-signal",
            "window-missing-sample-input",
            "window-unknown-key",
            "window-format-mismatch",
            "window-clock-mismatch",
            "window-bytecode-duration",
        ] {
            let error = verify_portable_package(&fixture_for(scenario), &current).unwrap_err();
            assert_eq!(
                error.code,
                ErrorCode::ManifestMismatch,
                "{scenario}: {error:?}"
            );
            assert!(!called.get(), "{scenario} reached target loader");
        }
    }

    #[test]
    fn signed_nested_window_dependencies_bind_to_verified_bytecode() {
        let called = std::cell::Cell::new(false);
        let loader =
            |bytes: &[u8], _: &TargetLoaderContext<'_>| -> std::result::Result<bool, String> {
                called.set(true);
                ghostflow_core::Module::load(bytes)
                    .map(|_| true)
                    .map_err(|error| error.to_string())
            };
        let capabilities = vec![
            Capability {
                kind: "actuator".into(),
                name: "pump".into(),
                value_type: "bool".into(),
            },
            Capability {
                kind: "sensor".into(),
                name: "probe".into(),
                value_type: "number".into(),
            },
        ];
        let formats = strings(&["GhostFlow/control-v4"]);
        let mut current = profile(&loader);
        current.available_capabilities = &capabilities;
        current.supported_manifest_formats = &formats;
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        for scenario in [
            "valid",
            "dependency-removed",
            "dependency-empty",
            "dependency-site",
            "dependency-slot",
            "dependency-name",
            "dependency-unknown-key",
            "dependency-null",
            "dependency-object",
            "dependency-negative-slot",
            "dependency-huge-slot",
            "dependency-negative-site",
            "dependency-huge-site",
        ] {
            called.set(false);
            let output = Command::new("node")
                .arg(root.join("tests/native-window-derived-fixture.mjs"))
                .arg(scenario)
                .current_dir(&root)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "fixture {scenario}: {}",
                String::from_utf8_lossy(&output.stderr)
            );
            let result = verify_portable_package(&output.stdout, &current);
            if scenario == "valid" {
                let verified = result.unwrap();
                assert!(called.get());
                assert_eq!(
                    verified.manifest["signals"][1]["upstreamWindows"][0]["name"],
                    "inner"
                );
            } else {
                assert_eq!(
                    result.unwrap_err().code,
                    ErrorCode::ManifestMismatch,
                    "{scenario}"
                );
                assert!(!called.get(), "{scenario} reached target loader");
            }
        }
    }

    #[test]
    fn actual_js_package_verifies_before_native_loader_receives_gfb() {
        let bytes = fixture();
        let loader = |bytes: &[u8],
                      context: &TargetLoaderContext<'_>|
         -> std::result::Result<bool, String> {
            assert_eq!(&bytes[..4], b"GFB1");
            assert_eq!(
                context.manifest["bytecodeSha256"].as_str(),
                Some(sha256_hex(bytes).as_str())
            );
            Ok(true)
        };
        let verified = verify_portable_package(&bytes, &profile(&loader)).unwrap();
        assert_eq!(verified.source.filename, "01-latch.ghost.md");
        assert_eq!(verified.accepted_key_ids, vec!["test-current-2026"]);
        assert_eq!(&verified.bytecode_copy()[..4], b"GFB1");
    }

    #[test]
    fn development_signature_policy_is_explicit_and_unauthenticated() {
        let loader = |_bytes: &[u8],
                      _context: &TargetLoaderContext<'_>|
         -> std::result::Result<bool, String> { Ok(true) };
        let mut envelope: Value = serde_json::from_slice(&fixture()).unwrap();
        envelope["signatures"] = serde_json::json!([]);
        let bytes = development_test_transport(&envelope);
        let mut current = profile(&loader);
        current.trusted_keys = &[];
        assert_eq!(
            verify_portable_package(&bytes, &current).unwrap_err().code,
            ErrorCode::SignatureCount
        );
        let admitted = verify_portable_package_with_signature_policy(
            &bytes,
            &current,
            SignaturePolicy::DevelopmentBypass,
        )
        .unwrap();
        assert_eq!(
            admitted.signature_authentication,
            SignatureAuthentication::DevelopmentBypass
        );
        assert!(admitted.accepted_key_ids.is_empty());
        let strict = verify_portable_package(&fixture(), &profile(&loader)).unwrap();
        assert_eq!(
            strict.signature_authentication,
            SignatureAuthentication::Authenticated
        );
        let untrusted = verify_portable_package_with_signature_policy(
            &fixture(),
            &current,
            SignaturePolicy::DevelopmentBypass,
        )
        .unwrap();
        assert!(untrusted.accepted_key_ids.is_empty());
        assert_eq!(untrusted.source.sha256, strict.source.sha256);
        assert_eq!(untrusted.bytecode_copy(), strict.bytecode_copy());
        envelope["signatures"] = serde_json::json!([{
            "algorithm": "Ed25519", "keyId": "test-current-2026",
            "signatureBase64": BASE64.encode([0u8; 64])
        }]);
        let bytes = development_test_transport(&envelope);
        assert_eq!(
            verify_portable_package(&bytes, &profile(&loader))
                .unwrap_err()
                .code,
            ErrorCode::UntrustedSignature
        );
        assert!(verify_portable_package_with_signature_policy(
            &bytes,
            &current,
            SignaturePolicy::DevelopmentBypass
        )
        .unwrap()
        .accepted_key_ids
        .is_empty());
    }

    #[test]
    fn development_bypass_retains_integrity_and_compatibility_checks() {
        let loader =
            |_bytes: &[u8],
             _context: &TargetLoaderContext<'_>|
             -> std::result::Result<bool, String> { panic!("loader must not run") };
        let mut envelope: Value = serde_json::from_slice(&fixture()).unwrap();
        envelope["signatures"] = serde_json::json!([]);
        envelope["payloadSha256"] = serde_json::json!("0".repeat(64));
        let bytes = development_test_transport(&envelope);
        assert_eq!(
            verify_portable_package_with_signature_policy(
                &bytes,
                &profile(&loader),
                SignaturePolicy::DevelopmentBypass
            )
            .unwrap_err()
            .code,
            ErrorCode::DigestMismatch
        );
        let mut current = profile(&loader);
        current.expected_binding_revision = "different-binding";
        assert_eq!(
            verify_portable_package_with_signature_policy(
                &fixture(),
                &current,
                SignaturePolicy::DevelopmentBypass
            )
            .unwrap_err()
            .code,
            ErrorCode::BindingRevisionMismatch
        );
        current = profile(&loader);
        current.supported_runtime_abis = &[];
        assert_eq!(
            verify_portable_package_with_signature_policy(
                &fixture(),
                &current,
                SignaturePolicy::DevelopmentBypass
            )
            .unwrap_err()
            .code,
            ErrorCode::InvalidVerifierOptions
        );
        for (artifact, expected) in [
            ("source", ErrorCode::SourceDigestMismatch),
            ("bytecode", ErrorCode::BytecodeDigestMismatch),
        ] {
            let mut envelope: Value = serde_json::from_slice(&fixture()).unwrap();
            envelope["payload"][artifact]["sha256"] = serde_json::json!("0".repeat(64));
            envelope["payloadSha256"] = serde_json::json!(sha256_hex(
                &canonical_json(&envelope["payload"], VerifierLimits::default()).unwrap()
            ));
            let bytes = development_test_transport(&envelope);
            assert_eq!(
                verify_portable_package_with_signature_policy(
                    &bytes,
                    &profile(&loader),
                    SignaturePolicy::DevelopmentBypass
                )
                .unwrap_err()
                .code,
                expected
            );
        }
    }

    #[test]
    fn development_bypass_rejects_malformed_signature_metadata() {
        let loader =
            |_bytes: &[u8],
             _context: &TargetLoaderContext<'_>|
             -> std::result::Result<bool, String> { panic!("loader must not run") };
        let base: Value = serde_json::from_slice(&fixture()).unwrap();
        for (field, value, expected) in [
            (
                "algorithm",
                "other",
                ErrorCode::UnsupportedSignatureAlgorithm,
            ),
            ("signatureBase64", "not base64", ErrorCode::InvalidBase64),
            ("signatureBase64", "AA==", ErrorCode::InvalidSchema),
            ("keyId", "", ErrorCode::InvalidIdentity),
        ] {
            let mut envelope = base.clone();
            envelope["signatures"][0][field] = serde_json::json!(value);
            let bytes = development_test_transport(&envelope);
            assert_eq!(
                verify_portable_package_with_signature_policy(
                    &bytes,
                    &profile(&loader),
                    SignaturePolicy::DevelopmentBypass
                )
                .unwrap_err()
                .code,
                expected
            );
        }
        let mut envelope = base;
        let signature = envelope["signatures"][0].clone();
        envelope["signatures"]
            .as_array_mut()
            .unwrap()
            .push(signature);
        let bytes = development_test_transport(&envelope);
        assert_eq!(
            verify_portable_package_with_signature_policy(
                &bytes,
                &profile(&loader),
                SignaturePolicy::DevelopmentBypass
            )
            .unwrap_err()
            .code,
            ErrorCode::DuplicateSignature
        );
        let mut current = profile(&loader);
        current.limits.max_signatures = 1;
        assert_eq!(
            verify_portable_package_with_signature_policy(
                &bytes,
                &current,
                SignaturePolicy::DevelopmentBypass
            )
            .unwrap_err()
            .code,
            ErrorCode::SignatureCount
        );
    }

    fn development_test_transport(envelope: &Value) -> Vec<u8> {
        let mut bytes = canonical_json(envelope, VerifierLimits::default()).unwrap();
        bytes.push(b'\n');
        bytes
    }

    #[test]
    fn tampered_transport_never_reaches_loader() {
        let mut bytes = fixture();
        let marker = b"\"payloadSha256\":\"";
        let position = bytes
            .windows(marker.len())
            .position(|window| window == marker)
            .unwrap()
            + marker.len();
        bytes[position] = if bytes[position] == b'0' { b'1' } else { b'0' };
        let loader =
            |_bytes: &[u8],
             _context: &TargetLoaderContext<'_>|
             -> std::result::Result<bool, String> { panic!("loader must not run") };
        assert_eq!(
            verify_portable_package(&bytes, &profile(&loader))
                .unwrap_err()
                .code,
            ErrorCode::DigestMismatch
        );
    }

    #[test]
    fn revoked_and_untrusted_keys_fail_closed() {
        let bytes = fixture();
        let loader = |_bytes: &[u8],
                      _context: &TargetLoaderContext<'_>|
         -> std::result::Result<bool, String> { Ok(true) };
        let mut revoked_profile = profile(&loader);
        let revoked = Box::leak(Box::new(vec!["test-current-2026".into()]));
        revoked_profile.revoked_key_ids = revoked;
        assert_eq!(
            verify_portable_package(&bytes, &revoked_profile)
                .unwrap_err()
                .code,
            ErrorCode::SigningKeyRevoked
        );
        let mut untrusted_profile = profile(&loader);
        let keys = Box::leak(Box::new(vec![TrustedKey {
            key_id: "other".into(),
            public_key: public_key(),
        }]));
        untrusted_profile.trusted_keys = keys;
        assert_eq!(
            verify_portable_package(&bytes, &untrusted_profile)
                .unwrap_err()
                .code,
            ErrorCode::UntrustedSignature
        );
    }

    #[test]
    fn abi_binding_and_capability_mismatches_fail_before_loader() {
        let bytes = fixture();
        let loader =
            |_bytes: &[u8],
             _context: &TargetLoaderContext<'_>|
             -> std::result::Result<bool, String> { panic!("loader must not run") };
        let mut abi = profile(&loader);
        abi.supported_runtime_abis =
            Box::leak(Box::new(strings(&["GhostFlow/framed-scan-abi-v2"])));
        assert_eq!(
            verify_portable_package(&bytes, &abi).unwrap_err().code,
            ErrorCode::UnsupportedRuntimeAbi
        );
        let mut binding = profile(&loader);
        binding.expected_binding_revision = "other-binding";
        assert_eq!(
            verify_portable_package(&bytes, &binding).unwrap_err().code,
            ErrorCode::BindingRevisionMismatch
        );
        let mut capability = profile(&loader);
        capability.available_capabilities = Box::leak(Box::new(vec![capabilities().remove(0)]));
        assert_eq!(
            verify_portable_package(&bytes, &capability)
                .unwrap_err()
                .code,
            ErrorCode::MissingCapability
        );
    }

    #[test]
    fn target_loader_must_explicitly_accept_bytecode() {
        let bytes = fixture();
        let reject = |_bytes: &[u8],
                      _context: &TargetLoaderContext<'_>|
         -> std::result::Result<bool, String> { Ok(false) };
        assert_eq!(
            verify_portable_package(&bytes, &profile(&reject))
                .unwrap_err()
                .code,
            ErrorCode::BytecodeRejected
        );
    }

    #[test]
    fn signed_unsupported_bytecode_version_fails_before_loader() {
        let bytes = fixture_for("unsupported-bytecode-version");
        let loader =
            |_bytes: &[u8],
             _context: &TargetLoaderContext<'_>|
             -> std::result::Result<bool, String> { panic!("loader must not run") };
        assert_eq!(
            verify_portable_package(&bytes, &profile(&loader))
                .unwrap_err()
                .code,
            ErrorCode::UnsupportedBytecodeVersion
        );
    }

    #[test]
    fn structurally_valid_gfb10_package_reaches_native_loader() {
        let bytes = fixture_for("gfb10-valid");
        let context_abis = strings(&["GhostFlow/context-scan-abi-v1"]);
        let loader =
            |bytes: &[u8], _: &TargetLoaderContext<'_>| -> std::result::Result<bool, String> {
                ghostflow_core::Module::load(bytes)
                    .map(|_| true)
                    .map_err(|error| error.to_string())
            };
        let capabilities = vec![Capability {
            kind: "actuator".into(),
            name: "due".into(),
            value_type: "bool".into(),
        }];
        let formats = strings(&["GhostFlow/control-v9"]);
        let mut current = profile(&loader);
        current.available_capabilities = &capabilities;
        current.supported_manifest_formats = &formats;
        current.supported_runtime_abis = &context_abis;
        current.expected_compiler_revision = "gfb10-package-test";
        current.expected_binding_revision = "gfb10-package-test-binding";

        let verified = verify_portable_package(&bytes, &current).unwrap();
        assert_eq!(&verified.bytecode_copy()[4..6], &[10, 0]);

        let mut runtime = ghostflow_core::Runtime::new(8);
        runtime.install(
            ghostflow_core::Module::load(&verified.bytecode_copy()).unwrap(),
            false,
        );
        runtime
            .add_capability(ghostflow_core::Capability::new(
                "actuator",
                "due",
                ghostflow_core::Type::Bool,
            ))
            .unwrap();
        runtime
            .activate_with_context(&ghostflow_core::context_runtime::Activation {
                boot_epoch: 1,
                terminal_capacity: 8,
                bindings: vec![],
            })
            .unwrap();
        let outcome = runtime
            .into_scan_driver()
            .scan_with_context(
                ghostflow_core::scan::ScanFrameV1 {
                    scan_id: 0,
                    logical_time_ms: 0,
                    inputs: vec![],
                },
                ghostflow_core::schedule_clock::ClockSnapshot {
                    boot_epoch: 1,
                    monotonic_ms: 0,
                    wall_ms: Some(1_790_812_799_999),
                    uncertainty_ms: Some(0),
                    trust: ghostflow_core::schedule_clock::ClockTrust::Trusted,
                    source_revision: Some("gfb10-pinned-test"),
                },
                &ghostflow_core::context_runtime::Facts {
                    schedules: vec![ghostflow_core::context_vm::ScheduleEvidence {
                        site: 14,
                        coverage_start_ms: 1_790_812_799_998,
                        coverage_end_ms: 1_790_812_800_000,
                        provider: None,
                        calendar: None,
                        rows: vec![],
                    }],
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(
            outcome.trace.safe_intents["due"],
            ghostflow_core::Value::Bool(false)
        );
        assert_eq!(
            outcome.trace.inputs["__gf_time_epoch"],
            ghostflow_core::Value::Number(1.0)
        );
    }

    #[test]
    fn malformed_gfb10_fails_structural_validation() {
        let error = validate_gfb1(b"GFB1\x0a\x00").unwrap_err();
        assert_eq!(error.code, ErrorCode::BytecodeRejected);
    }

    #[test]
    fn signed_gfb10_periodic_manifest_substitution_fails_before_loader() {
        let context_abis = strings(&["GhostFlow/context-scan-abi-v1"]);
        let loader = |_: &[u8], _: &TargetLoaderContext<'_>| -> std::result::Result<bool, String> {
            panic!("loader must not run")
        };
        let capabilities = vec![Capability {
            kind: "actuator".into(),
            name: "due".into(),
            value_type: "bool".into(),
        }];
        let formats = strings(&["GhostFlow/control-v9"]);
        let mut current = profile(&loader);
        current.available_capabilities = &capabilities;
        current.supported_manifest_formats = &formats;
        current.supported_runtime_abis = &context_abis;
        current.expected_compiler_revision = "gfb10-package-test";
        current.expected_binding_revision = "gfb10-package-test-binding";

        for scenario in ["gfb10-periodic-anchor", "gfb10-periodic-policy-missing"] {
            let bytes = fixture_for(scenario);
            assert_eq!(
                verify_portable_package(&bytes, &current).unwrap_err().code,
                ErrorCode::ManifestMismatch,
                "{scenario}"
            );
        }
    }

    #[test]
    fn signed_current_profiles_preserve_int_capability_identity() {
        for version in 1..=3 {
            let bytes = fixture_for(&format!("profile-{version}"));
            let loader =
                |bytes: &[u8], _: &TargetLoaderContext<'_>| -> std::result::Result<bool, String> {
                    assert_eq!(u16::from_le_bytes([bytes[4], bytes[5]]), version);
                    Ok(true)
                };
            let mut capabilities = capabilities();
            let manifests = strings(&["GhostFlow/control-v1", "GhostFlow/control-v4"]);
            if version >= 2 {
                capabilities[0].value_type = "int".into();
            }
            let mut current = profile(&loader);
            current.available_capabilities = &capabilities;
            current.supported_manifest_formats = &manifests;
            let verified = verify_portable_package(&bytes, &current).unwrap();
            assert_eq!(
                u16::from_le_bytes([verified.bytecode_copy()[4], verified.bytecode_copy()[5]]),
                version
            );
        }
    }

    #[test]
    fn signed_descriptor_mismatches_and_unknown_headers_fail_before_loader() {
        for (scenario, code) in [
            ("version-mismatch-1", "bytecode-version-mismatch"),
            ("version-mismatch-2", "bytecode-version-mismatch"),
            ("unsupported-header", "unsupported-bytecode-version"),
        ] {
            let bytes = fixture_for(scenario);
            let loader =
                |_: &[u8], _: &TargetLoaderContext<'_>| -> std::result::Result<bool, String> {
                    panic!("loader must not run")
                };
            assert_eq!(
                verify_portable_package(&bytes, &profile(&loader))
                    .unwrap_err()
                    .code
                    .as_str(),
                code
            );
        }
    }

    #[test]
    fn signed_quantity_descriptors_require_exact_canonical_units_before_loading() {
        let capabilities: Vec<_> = (0..17)
            .flat_map(|index| {
                [
                    Capability {
                        kind: "input".into(),
                        name: format!("input_{index}"),
                        value_type: "number".into(),
                    },
                    Capability {
                        kind: "actuator".into(),
                        name: format!("output_{index}"),
                        value_type: "number".into(),
                    },
                ]
            })
            .chain([
                Capability {
                    kind: "input".into(),
                    name: "enabled".into(),
                    value_type: "bool".into(),
                },
                Capability {
                    kind: "sensor".into(),
                    name: "probe".into(),
                    value_type: "number".into(),
                },
            ])
            .collect();
        let accept =
            |_: &[u8], context: &TargetLoaderContext<'_>| -> std::result::Result<bool, String> {
                assert_eq!(context.manifest["inputs"].as_array().unwrap().len(), 18);
                assert_eq!(context.manifest["inputs"][0]["canonicalUnit"], "K");
                assert_eq!(context.manifest["inputs"][16]["canonicalUnit"], "pH");
                Ok(true)
            };
        let mut current = profile(&accept);
        current.available_capabilities = &capabilities;
        verify_portable_package(&fixture_for("quantity-valid"), &current).unwrap();
        let reject_loader =
            |_: &[u8], _: &TargetLoaderContext<'_>| -> std::result::Result<bool, String> {
                panic!("invalid units must reject before loader")
            };
        current.target_loader = &reject_loader;
        for scenario in [
            "quantity-missing-unit",
            "quantity-wrong-unit",
            "quantity-extra-field",
            "quantity-wrong-type",
            "quantity-scalar-unit",
            "quantity-sensor-unit",
            "quantity-config-unit",
            "quantity-scalar-config-unit",
        ] {
            let error = verify_portable_package(&fixture_for(scenario), &current).unwrap_err();
            assert_eq!(
                error.code,
                ErrorCode::ManifestMismatch,
                "{scenario}: {error:?}"
            );
        }
    }

    #[test]
    fn time_config_values_reject_invalid_numeric_representations() {
        for (nominal, maximum) in [
            ("Date", 2932896_f64),
            ("TimeOfDay", 86399999_f64),
            ("DateTime", 253402300799999_f64),
        ] {
            let mut manifest = serde_json::json!({
                "format": "GhostFlow/control-v1", "name": "Times", "bytecodeSha256": "digest",
                "inputs": [], "outputs": [], "sensors": [], "schedules": [], "timers": [], "signals": [],
                "configs": [{"name": "value", "type": nominal, "value": 0}]
            });
            for valid in [0.0, maximum] {
                manifest["configs"][0]["value"] = serde_json::json!(valid);
                verify_manifest(&manifest, "GhostFlow/control-v1", "digest", &[]).unwrap();
            }
            for invalid in [
                serde_json::json!(-1),
                serde_json::json!(0.5),
                serde_json::json!(maximum + 1.0),
                serde_json::json!("0"),
                Value::Null,
            ] {
                manifest["configs"][0]["value"] = invalid;
                assert_eq!(
                    verify_manifest(&manifest, "GhostFlow/control-v1", "digest", &[])
                        .unwrap_err()
                        .code,
                    ErrorCode::ManifestMismatch
                );
            }
        }
    }

    #[test]
    fn int_config_values_bounds_and_grid_are_exact() {
        let manifest = serde_json::json!({
            "format":"GhostFlow/control-v4", "name":"Ints", "bytecodeSha256":"digest",
            "inputs":[], "outputs":[], "sensors":[], "signals":[], "schedules":[], "timers":[],
            "configs":[{"name":"count", "type":"Int", "value":1,
                "settings":{"min":-2147483648_i64, "max":2147483647_i64, "step":1, "access":"operator"}}]
        });
        verify_manifest(&manifest, "GhostFlow/control-v4", "digest", &[]).unwrap();
        for value in [-2147483648_i64, 2147483647] {
            let mut valid = manifest.clone();
            valid["configs"][0]["value"] = serde_json::json!(value);
            verify_manifest(&valid, "GhostFlow/control-v4", "digest", &[]).unwrap();
        }
        for field in ["value", "min", "max", "step"] {
            for invalid in [
                serde_json::json!(0.5),
                serde_json::json!(2147483648_i64),
                serde_json::json!(-2147483649_i64),
                serde_json::json!("1"),
                Value::Null,
            ] {
                let mut bad = manifest.clone();
                if field == "value" {
                    bad["configs"][0][field] = invalid;
                } else {
                    bad["configs"][0]["settings"][field] = invalid;
                }
                assert_eq!(
                    verify_manifest(&bad, "GhostFlow/control-v4", "digest", &[])
                        .unwrap_err()
                        .code,
                    ErrorCode::ManifestMismatch,
                    "{field}"
                );
            }
        }
        for settings in [
            serde_json::json!({"min":0,"max":2147483647,"step":2147483647,"access":"operator"}),
            serde_json::json!({"min":2,"max":1,"step":1,"access":"operator"}),
            serde_json::json!({"min":0,"max":2,"step":0,"access":"operator"}),
            serde_json::json!({"min":0,"max":2,"step":-1,"access":"operator"}),
            serde_json::json!({"min":1,"max":4,"step":2,"access":"operator"}),
            serde_json::json!({"min":0,"max":2,"step":1,"access":"operator","stepType":"Int"}),
        ] {
            let mut bad = manifest.clone();
            bad["configs"][0]["settings"] = settings;
            assert_eq!(
                verify_manifest(&bad, "GhostFlow/control-v4", "digest", &[])
                    .unwrap_err()
                    .code,
                ErrorCode::ManifestMismatch
            );
        }
        let mut wide = manifest.clone();
        wide["configs"][0]["value"] = serde_json::json!(2147483646);
        wide["configs"][0]["settings"] = serde_json::json!({"min":-2147483648_i64,"max":2147483646,"step":2147483647,"access":"operator"});
        verify_manifest(&wide, "GhostFlow/control-v4", "digest", &[]).unwrap();
        for access in ["operator", "designer"] {
            let mut metadata = manifest.clone();
            metadata["configs"][0]["settings"]["access"] = serde_json::json!(access);
            metadata["configs"][0]["settings"]["apply"] = serde_json::json!("stopped");
            metadata["configs"][0]["settings"]["label"] = serde_json::json!("🌿".repeat(64));
            verify_manifest(&metadata, "GhostFlow/control-v4", "digest", &[]).unwrap();
        }
        let mut plain = manifest.clone();
        plain["configs"][0]
            .as_object_mut()
            .unwrap()
            .remove("settings");
        verify_manifest(&plain, "GhostFlow/control-v4", "digest", &[]).unwrap();
    }

    #[test]
    fn signed_int_settings_reject_invalid_domains_and_grid_before_loader() {
        let capabilities = [Capability {
            kind: "actuator".into(),
            name: "count".into(),
            value_type: "int".into(),
        }];
        let called = std::cell::Cell::new(false);
        let accept = |bytes: &[u8],
                      context: &TargetLoaderContext<'_>|
         -> std::result::Result<bool, String> {
            called.set(true);
            for (index, expected) in [-2147483648_i64, 2147483647, 2147483646, 0, 0]
                .into_iter()
                .enumerate()
            {
                assert_eq!(
                    context.manifest["configs"][index]["value"].as_i64(),
                    Some(expected)
                );
                assert!(context.manifest["configs"][index]["settings"]
                    .get("stepType")
                    .is_none());
            }
            ghostflow_core::Module::load(bytes)
                .map(|_| true)
                .map_err(|error| error.to_string())
        };
        let mut current = profile(&accept);
        current.available_capabilities = &capabilities;
        let formats = strings(&["GhostFlow/control-v10"]);
        current.supported_manifest_formats = &formats;
        verify_portable_package(&fixture_for("int-settings-valid"), &current).unwrap();
        assert!(called.get());
        called.set(false);
        let reject = |_: &[u8], _: &TargetLoaderContext<'_>| -> std::result::Result<bool, String> {
            called.set(true);
            Ok(true)
        };
        current.target_loader = &reject;
        let mut scenarios = Vec::new();
        for field in ["value", "min", "max", "step"] {
            for kind in [
                "fraction",
                "underflow",
                "overflow",
                "string",
                "null",
                "missing",
            ] {
                scenarios.push(format!("int-settings-{field}-{kind}"));
            }
        }
        scenarios.extend(
            [
                "step-zero",
                "step-negative",
                "inverted",
                "default-grid",
                "max-grid",
                "outside-range",
                "extra-step-type",
                "plain-invalid",
                "access-missing",
                "access-invalid",
                "access-null",
                "apply-live",
                "apply-null",
                "label-empty",
                "label-long",
                "label-surrogates",
                "label-number",
                "unknown-key",
                "object-null",
            ]
            .map(|case| format!("int-settings-{case}")),
        );
        for scenario in scenarios {
            let error = match verify_portable_package(&fixture_for(&scenario), &current) {
                Err(error) => error,
                Ok(_) => panic!("{scenario}: invalid signed Int settings accepted"),
            };
            assert_eq!(
                error.code,
                ErrorCode::ManifestMismatch,
                "{scenario}: {error:?}"
            );
            assert!(!called.get(), "{scenario} reached target loader");
        }
    }

    #[test]
    fn signed_config_stream_package_binds_manifest_and_context_abi_before_loader() {
        let reject = |_: &[u8], _: &TargetLoaderContext<'_>| -> std::result::Result<bool, String> {
            panic!("inconsistent signed config package must reject before target loader")
        };
        let mut current = profile(&reject);
        let capabilities = vec![Capability {
            kind: "actuator".into(),
            name: "count".into(),
            value_type: "int".into(),
        }];
        current.available_capabilities = &capabilities;
        for scenario in [
            "int-settings-bytecode-mismatch",
            "int-settings-context-abi-mismatch",
        ] {
            assert_eq!(
                verify_portable_package(&fixture_for(scenario), &current)
                    .unwrap_err()
                    .code,
                ErrorCode::ManifestMismatch,
                "{scenario}"
            );
        }
    }

    #[test]
    fn signed_config_stream_with_elapsed_timer_preserves_native_execution() {
        let accept = |bytes: &[u8],
                      context: &TargetLoaderContext<'_>|
         -> std::result::Result<bool, String> {
            assert_eq!(context.manifest["timers"][0]["name"], "age");
            let module = ghostflow_core::Module::load(bytes).map_err(|e| e.to_string())?;
            let mut runtime = ghostflow_core::Runtime::new(4);
            runtime.install(module, false);
            runtime
                .add_capability(ghostflow_core::Capability {
                    kind: "actuator".into(),
                    name: "pump".into(),
                    value_type: ghostflow_core::Type::Bool,
                })
                .map_err(|e| e.to_string())?;
            runtime
                .activate_with_context(&ghostflow_core::context_runtime::Activation {
                    boot_epoch: 1,
                    terminal_capacity: 16,
                    bindings: vec![],
                })
                .map_err(|e| e.to_string())?;
            for (mono, expected) in [(0, true), (2_000, false)] {
                for (name, value) in [
                    ("start", ghostflow_core::Value::Bool(true)),
                    ("__gf_now_ms", ghostflow_core::Value::Number(mono as f64)),
                    ("__gf_time_epoch", ghostflow_core::Value::Number(1.0)),
                ] {
                    runtime.set_input(name, value).map_err(|e| e.to_string())?;
                }
                let record = runtime
                    .tick_with_context(
                        ghostflow_core::schedule_clock::ClockSnapshot {
                            boot_epoch: 1,
                            monotonic_ms: mono,
                            wall_ms: None,
                            uncertainty_ms: None,
                            trust: ghostflow_core::schedule_clock::ClockTrust::Unknown(
                                "not-required",
                            ),
                            source_revision: None,
                        },
                        &ghostflow_core::context_runtime::Facts {
                            natural: vec![],
                            schedules: vec![],
                            settings: None,
                            accounting: vec![],
                        },
                    )
                    .map_err(|e| e.to_string())?;
                assert_eq!(
                    record.safe_intents["pump"],
                    ghostflow_core::Value::Bool(expected)
                );
            }
            Ok(true)
        };
        let mut current = profile(&accept);
        let capabilities = [
            Capability {
                kind: "actuator".into(),
                name: "pump".into(),
                value_type: "bool".into(),
            },
            Capability {
                kind: "input".into(),
                name: "start".into(),
                value_type: "bool".into(),
            },
        ];
        current.available_capabilities = &capabilities;
        verify_portable_package(&fixture_for("config-timer-valid"), &current).unwrap();
    }

    #[test]
    fn time_config_settings_preserve_nominal_step_and_grid() {
        for (nominal, maximum, step_type, step_maximum) in [
            ("Date", 2932896_f64, "Int", 2147483647_f64),
            ("TimeOfDay", 86399999_f64, "Duration", 9007199254740991_f64),
            (
                "DateTime",
                253402300799999_f64,
                "Duration",
                9007199254740991_f64,
            ),
        ] {
            let mut manifest = serde_json::json!({
                "format": "GhostFlow/control-v1", "name": "Times", "bytecodeSha256": "digest",
                "inputs": [], "outputs": [], "sensors": [], "schedules": [], "timers": [], "signals": [],
                "configs": [{"name": "value", "type": nominal, "value": 1,
                    "settings": {"min": 0, "max": maximum, "step": 1, "stepType": step_type}}]
            });
            verify_manifest(&manifest, "GhostFlow/control-v1", "digest", &[]).unwrap();
            let valid = manifest["configs"][0]["settings"].clone();
            for (field, invalid) in [
                ("min", serde_json::json!(-1)),
                ("max", serde_json::json!(maximum + 1.0)),
                ("min", serde_json::json!(2)),
                ("max", serde_json::json!(0)),
                ("step", serde_json::json!(2)),
                ("step", serde_json::json!(0)),
                ("step", serde_json::json!(0.5)),
                ("step", serde_json::json!(step_maximum + 1.0)),
                ("min", serde_json::json!("0")),
                ("stepType", serde_json::json!("Number")),
                ("stepType", Value::Null),
            ] {
                manifest["configs"][0]["settings"] = valid.clone();
                manifest["configs"][0]["settings"][field] = invalid;
                assert_eq!(
                    verify_manifest(&manifest, "GhostFlow/control-v1", "digest", &[])
                        .unwrap_err()
                        .code,
                    ErrorCode::ManifestMismatch,
                    "{nominal}.{field}"
                );
            }
            manifest["configs"][0]["value"] = serde_json::json!(0);
            manifest["configs"][0]["settings"] =
                serde_json::json!({"min": 0, "max": 3, "step": 2, "stepType": step_type});
            assert_eq!(
                verify_manifest(&manifest, "GhostFlow/control-v1", "digest", &[])
                    .unwrap_err()
                    .code,
                ErrorCode::ManifestMismatch
            );
        }
    }

    #[test]
    fn signed_time_descriptors_require_integral_bounded_configs_before_loading() {
        let capabilities: Vec<_> = (0..3)
            .flat_map(|index| {
                ["input", "actuator"].map(|kind| Capability {
                    kind: kind.into(),
                    name: format!(
                        "{}_{index}",
                        if kind == "input" { "input" } else { "output" }
                    ),
                    value_type: "number".into(),
                })
            })
            .collect();
        let accept =
            |_: &[u8], context: &TargetLoaderContext<'_>| -> std::result::Result<bool, String> {
                for (index, nominal) in ["Date", "TimeOfDay", "DateTime"].iter().enumerate() {
                    assert_eq!(context.manifest["inputs"][index]["type"], *nominal);
                    assert!(context.manifest["inputs"][index]
                        .get("canonicalUnit")
                        .is_none());
                }
                for (index, value) in [0_u64, 2932896, 0, 86399999, 0, 253402300799999]
                    .iter()
                    .enumerate()
                {
                    assert_eq!(
                        context.manifest["configs"][index]["value"].as_u64(),
                        Some(*value)
                    );
                }
                Ok(true)
            };
        let mut current = profile(&accept);
        current.available_capabilities = &capabilities;
        let formats = strings(&["GhostFlow/control-v10"]);
        current.supported_manifest_formats = &formats;
        verify_portable_package(&fixture_for("time-valid"), &current).unwrap();
        let reject_loader =
            |_: &[u8], _: &TargetLoaderContext<'_>| -> std::result::Result<bool, String> {
                panic!("invalid time metadata must reject before loader")
            };
        current.target_loader = &reject_loader;
        let mut scenarios = vec![
            "time-port-unit".to_owned(),
            "time-config-unit".to_owned(),
            "time-wrong-type".to_owned(),
            "time-config-string".to_owned(),
            "time-config-null".to_owned(),
            "time-config-missing".to_owned(),
            "time-settings-step-type".to_owned(),
            "time-settings-missing-step-type".to_owned(),
            "time-settings-step-overflow".to_owned(),
            "time-settings-grid".to_owned(),
            "time-settings-range".to_owned(),
        ];
        for index in 0..3 {
            for kind in ["negative", "fractional", "overflow"] {
                scenarios.push(format!("time-config-{index}-{kind}"));
            }
        }
        for scenario in scenarios {
            let error = verify_portable_package(&fixture_for(&scenario), &current).unwrap_err();
            assert_eq!(
                error.code,
                ErrorCode::ManifestMismatch,
                "{scenario}: {error:?}"
            );
        }
    }

    #[test]
    fn hold_last_manifest_domains_and_private_roles_are_strict() {
        let mut descriptor = serde_json::json!({
            "kind":"hold-last", "name":"held", "payloadType":"Number",
            "errorType":"SensorFault", "quality":"measured", "sourceMode":"sample",
            "forAtMostMs":2000, "clockInput":"__gf_now_ms",
            "sources":[{"name":"probe", "tag":7, "states":{
                "lastEpoch":"__gf_hold_last_source_epoch_held_7",
                "lastId":"__gf_hold_last_source_id_held_7"
            }}], "states":{}
        });
        let roles = [
            ("available", "available"),
            ("value", "value"),
            ("heldSourceTag", "held_source_tag"),
            ("heldEpoch", "held_epoch"),
            ("heldId", "held_id"),
            ("heldTimestamp", "held_timestamp"),
            ("held", "held"),
            ("age", "age"),
            ("maskedFaultPresent", "masked_fault_present"),
            ("maskedFaultCode", "masked_fault_code"),
            ("maskedFaultOrigin", "masked_fault_origin"),
        ];
        for (role, suffix) in roles {
            descriptor["states"][role] = serde_json::json!(format!("__gf_hold_last_{suffix}_held"));
        }
        let manifest = serde_json::json!({
            "format":"GhostFlow/control-v1", "name":"Hold", "bytecodeSha256":"digest",
            "inputs":[], "outputs":[], "schedules":[], "timers":[], "configs":[],
            "signals":[descriptor], "sensors":[{
                "name":"probe", "type":"Number", "valueInput":"__gf_sensor_value_probe",
                "okInput":"__gf_sensor_ok_probe", "faultInput":"__gf_sensor_fault_probe",
                "samplePresentInput":"__gf_sensor_sample_present_probe",
                "sampleEpochInput":"__gf_sensor_sample_epoch_probe",
                "sampleIdInput":"__gf_sensor_sample_id_probe",
                "sampleTimestampInput":"__gf_sensor_sample_timestamp_probe"
            }]
        });
        let caps = [Capability {
            kind: "sensor".into(),
            name: "probe".into(),
            value_type: "number".into(),
        }];
        verify_manifest(&manifest, "GhostFlow/control-v1", "digest", &caps).unwrap();
        for payload in [
            "Bool",
            "Int",
            "Percent",
            "Duration",
            "Date",
            "TimeOfDay",
            "DateTime",
            "Temperature",
        ] {
            let mut valid = manifest.clone();
            valid["signals"][0]["payloadType"] = serde_json::json!(payload);
            verify_manifest(&valid, "GhostFlow/control-v1", "digest", &caps).unwrap();
        }
        for (field, bad) in [
            ("quality", serde_json::json!("estimated")),
            ("errorType", Value::Null),
            ("errorType", serde_json::json!("ClockFault")),
            ("sourceMode", serde_json::json!("scan")),
            ("sources", serde_json::json!([])),
            ("forAtMostMs", serde_json::json!(0)),
            ("forAtMostMs", serde_json::json!(-1)),
            ("forAtMostMs", serde_json::json!(0.5)),
            ("forAtMostMs", serde_json::json!(9007199254740992_u64)),
            ("payloadType", serde_json::json!("Result")),
            ("members", serde_json::json!(["A"])),
            ("initial", serde_json::json!(0)),
        ] {
            let mut invalid = manifest.clone();
            invalid["signals"][0][field] = bad;
            assert_eq!(
                verify_manifest(&invalid, "GhostFlow/control-v1", "digest", &caps)
                    .unwrap_err()
                    .code,
                ErrorCode::ManifestMismatch,
                "{field}"
            );
        }
        for (role, _) in roles {
            let mut invalid = manifest.clone();
            invalid["signals"][0]["states"]
                .as_object_mut()
                .unwrap()
                .remove(role);
            assert_eq!(
                verify_manifest(&invalid, "GhostFlow/control-v1", "digest", &caps)
                    .unwrap_err()
                    .code,
                ErrorCode::ManifestMismatch,
                "missing {role}"
            );
        }
        for payload in [
            "Mode",
            "SensorFault",
            "ClockFault",
            "CalendarFault",
            "TemporalContextFault",
        ] {
            let mut enumeration = manifest.clone();
            enumeration["signals"][0]["payloadType"] = serde_json::json!(payload);
            let members = fault_members(payload).unwrap_or(&["Off", "On"]);
            enumeration["signals"][0]["members"] = serde_json::json!(members);
            verify_manifest(&enumeration, "GhostFlow/control-v1", "digest", &caps).unwrap();
            enumeration["signals"][0]["members"] = serde_json::json!(["Off", "Off"]);
            assert_eq!(
                verify_manifest(&enumeration, "GhostFlow/control-v1", "digest", &caps)
                    .unwrap_err()
                    .code,
                ErrorCode::ManifestMismatch,
                "{payload} members"
            );
        }
        let mut maximal_duration = manifest.clone();
        maximal_duration["signals"][0]["forAtMostMs"] = serde_json::json!(9007199254740991_u64);
        verify_manifest(&maximal_duration, "GhostFlow/control-v1", "digest", &caps).unwrap();
        let mut bounded = manifest.clone();
        bounded["signals"] = Value::Array(
            (0..9)
                .map(|index| {
                    let mut signal = descriptor.clone();
                    let name = format!("held{index}");
                    signal["name"] = serde_json::json!(name);
                    for (role, suffix) in roles {
                        signal["states"][role] =
                            serde_json::json!(format!("__gf_hold_last_{suffix}_{name}"));
                    }
                    for (role, suffix) in [("lastEpoch", "source_epoch"), ("lastId", "source_id")] {
                        signal["sources"][0]["states"][role] =
                            serde_json::json!(format!("__gf_hold_last_{suffix}_{name}_7"));
                    }
                    signal
                })
                .collect(),
        );
        verify_manifest(&bounded, "GhostFlow/control-v1", "digest", &caps).unwrap();
        bounded["signals"].as_array_mut().unwrap().push(descriptor);
        let error = verify_manifest(&bounded, "GhostFlow/control-v1", "digest", &caps).unwrap_err();
        assert_eq!(error.code, ErrorCode::ManifestMismatch);
        assert_eq!(
            error.message,
            "temporal signal generated resources exceed the 128 field profile"
        );
    }

    #[test]
    fn debounce_manifest_domains_and_private_roles_are_strict() {
        let descriptor = serde_json::json!({
            "kind": "debounce", "name": "stable", "payloadType": "Bool",
            "errorType": null, "sourceMode": "scan", "stableForMs": 2000,
            "initial": false, "clockInput": "__gf_now_ms", "sources": [],
            "states": {
                "stable": "__gf_debounce_stable_stable",
                "candidate": "__gf_debounce_candidate_stable",
                "candidateActive": "__gf_debounce_candidate_active_stable",
                "candidateSince": "__gf_debounce_candidate_since_stable",
                "lastSourceTag": "__gf_debounce_last_source_tag_stable"
            }
        });
        let manifest = serde_json::json!({
            "format": "GhostFlow/control-v1", "name": "Debounce", "bytecodeSha256": "digest",
            "inputs": [], "outputs": [], "sensors": [], "schedules": [], "timers": [],
            "configs": [], "signals": [descriptor]
        });
        verify_manifest(&manifest, "GhostFlow/control-v1", "digest", &[]).unwrap();
        let mut enumeration = manifest.clone();
        enumeration["signals"][0]["payloadType"] = serde_json::json!("Mode");
        enumeration["signals"][0]["members"] = serde_json::json!(["Off", "On"]);
        enumeration["signals"][0]["initial"] = serde_json::json!(0);
        verify_manifest(&enumeration, "GhostFlow/control-v1", "digest", &[]).unwrap();
        for name in [
            "SensorFault",
            "ClockFault",
            "CalendarFault",
            "TemporalContextFault",
        ] {
            let mut builtin = enumeration.clone();
            builtin["signals"][0]["payloadType"] = serde_json::json!(name);
            builtin["signals"][0]["members"] = serde_json::json!(fault_members(name).unwrap());
            verify_manifest(&builtin, "GhostFlow/control-v1", "digest", &[]).unwrap();
            builtin["signals"][0]["members"]
                .as_array_mut()
                .unwrap()
                .reverse();
            assert_eq!(
                verify_manifest(&builtin, "GhostFlow/control-v1", "digest", &[])
                    .unwrap_err()
                    .code,
                ErrorCode::ManifestMismatch,
                "{name} fixed enum order"
            );
        }
        for (field, bad) in [
            ("stableForMs", serde_json::json!(0)),
            ("stableForMs", serde_json::json!(-1)),
            ("stableForMs", serde_json::json!(0.5)),
            ("stableForMs", serde_json::json!(9007199254740992_u64)),
            ("initial", serde_json::json!(0)),
            ("payloadType", serde_json::json!("Number")),
            ("errorType", serde_json::json!("UserFault")),
            ("sourceMode", serde_json::json!("physical")),
            ("clockInput", serde_json::json!("clock")),
            ("members", serde_json::json!(["Off", "On"])),
            ("kind", serde_json::json!("unknown")),
        ] {
            let mut invalid = manifest.clone();
            invalid["signals"][0][field] = bad;
            assert_eq!(
                verify_manifest(&invalid, "GhostFlow/control-v1", "digest", &[])
                    .unwrap_err()
                    .code,
                ErrorCode::ManifestMismatch,
                "field {field}"
            );
        }
        for bad in [
            serde_json::json!([]),
            serde_json::json!(["Off", "Off"]),
            serde_json::json!(["Bad Member"]),
        ] {
            let mut invalid = enumeration.clone();
            invalid["signals"][0]["members"] = bad;
            assert_eq!(
                verify_manifest(&invalid, "GhostFlow/control-v1", "digest", &[])
                    .unwrap_err()
                    .code,
                ErrorCode::ManifestMismatch
            );
        }
        for bad in [-1.0, 0.5, 2.0] {
            let mut invalid = enumeration.clone();
            invalid["signals"][0]["initial"] = serde_json::json!(bad);
            assert_eq!(
                verify_manifest(&invalid, "GhostFlow/control-v1", "digest", &[])
                    .unwrap_err()
                    .code,
                ErrorCode::ManifestMismatch
            );
        }
        for role in [
            "stable",
            "candidate",
            "candidateActive",
            "candidateSince",
            "lastSourceTag",
        ] {
            let mut invalid = manifest.clone();
            invalid["signals"][0]["states"]
                .as_object_mut()
                .unwrap()
                .remove(role);
            assert_eq!(
                verify_manifest(&invalid, "GhostFlow/control-v1", "digest", &[])
                    .unwrap_err()
                    .code,
                ErrorCode::ManifestMismatch,
                "missing {role}"
            );
            invalid = manifest.clone();
            invalid["signals"][0]["states"][role] = serde_json::json!("__gf_debounce_stable_other");
            assert_eq!(
                verify_manifest(&invalid, "GhostFlow/control-v1", "digest", &[])
                    .unwrap_err()
                    .code,
                ErrorCode::ManifestMismatch,
                "wrong {role}"
            );
        }
        let mut oversized = manifest.clone();
        oversized["signals"] = Value::Array(
            (0..26)
                .map(|index| {
                    let mut signal = descriptor.clone();
                    let name = format!("stable{index}");
                    signal["name"] = serde_json::json!(name);
                    for (role, suffix) in DEBOUNCE_ROLES {
                        signal["states"][role] =
                            serde_json::json!(format!("__gf_debounce_{suffix}_{name}"));
                    }
                    signal
                })
                .collect(),
        );
        assert_eq!(
            verify_manifest(&oversized, "GhostFlow/control-v1", "digest", &[])
                .unwrap_err()
                .code,
            ErrorCode::ManifestMismatch,
            "26 raw debounce nodes exceed 128 private states"
        );
    }

    #[test]
    fn signed_hold_last_domains_and_bytecode_bindings_are_checked_before_target_loader() {
        let capabilities: Vec<_> = [
            ("input", "start", "bool"),
            ("sensor", "probe", "number"),
            ("sensor", "backup", "number"),
            ("actuator", "measuredResult", "bool"),
            ("actuator", "finiteResult", "bool"),
            ("actuator", "booleanResult", "bool"),
            ("actuator", "integerResult", "bool"),
        ]
        .into_iter()
        .map(|(kind, name, value_type)| Capability {
            kind: kind.into(),
            name: name.into(),
            value_type: value_type.into(),
        })
        .collect();
        let accept =
            |bytes: &[u8], _: &TargetLoaderContext<'_>| -> std::result::Result<bool, String> {
                ghostflow_core::Module::load(bytes)
                    .map(|_| true)
                    .map_err(|error| error.to_string())
            };
        let mut current = profile(&accept);
        current.available_capabilities = &capabilities;
        let formats = strings(&["GhostFlow/control-v1", "GhostFlow/control-v4"]);
        current.supported_manifest_formats = &formats;
        verify_portable_package(&fixture_for("hold-basic-valid"), &current).unwrap();
        let error =
            match verify_portable_package(&fixture_for("hold-basic-bytecode-default"), &current) {
                Err(error) => error,
                Ok(_) => panic!("forged hold state default was accepted"),
            };
        assert_eq!(error.code, ErrorCode::ManifestMismatch);
        verify_portable_package(&fixture_for("hold-valid"), &current).unwrap();
        let called = std::cell::Cell::new(false);
        let reject = |_: &[u8], _: &TargetLoaderContext<'_>| -> std::result::Result<bool, String> {
            called.set(true);
            Ok(true)
        };
        current.target_loader = &reject;
        let mut scenarios: Vec<String> = [
            "hold-duration-missing",
            "hold-duration-zero",
            "hold-duration-fraction",
            "hold-duration-overflow",
            "hold-quality",
            "hold-error-type",
            "hold-extra-field",
            "hold-role-missing",
            "hold-role-wrong",
            "hold-payload-type",
            "hold-enum-missing",
            "hold-enum-duplicate",
            "hold-enum-built-in",
            "hold-source-empty",
            "hold-source-mode",
            "hold-source-unknown",
            "hold-source-tag-zero",
            "hold-source-reordered",
            "hold-source-id-missing",
            "hold-source-state-extra",
            "hold-source-history-alias",
            "hold-sample-missing",
            "hold-sample-wrong",
            "hold-descriptors-deleted",
            "hold-bytecode-int-default",
            "hold-bytecode-bool-default",
            "hold-bytecode-source-id-default",
            "hold-bytecode-source-epoch-default",
            "hold-bytecode-state-name",
            "hold-bytecode-source-state-name",
            "hold-bytecode-sample-name",
        ]
        .into_iter()
        .map(str::to_owned)
        .collect();
        scenarios.extend(HOLD_LAST_ROLES.map(|(role, _)| format!("hold-bytecode-default-{role}")));
        for scenario in scenarios {
            let error = verify_portable_package(&fixture_for(&scenario), &current).unwrap_err();
            let expected = if scenario == "hold-duration-overflow" {
                ErrorCode::InvalidCanonicalJson
            } else {
                ErrorCode::ManifestMismatch
            };
            assert_eq!(error.code, expected, "{scenario}: {error:?}");
            assert!(!called.get(), "{scenario} reached target loader");
        }
    }

    #[test]
    fn signed_debounce_domains_and_bytecode_bindings_are_checked_before_target_loader() {
        let capabilities = vec![
            Capability {
                kind: "input".into(),
                name: "start".into(),
                value_type: "bool".into(),
            },
            Capability {
                kind: "sensor".into(),
                name: "probe".into(),
                value_type: "bool".into(),
            },
            Capability {
                kind: "sensor".into(),
                name: "backup".into(),
                value_type: "bool".into(),
            },
            Capability {
                kind: "actuator".into(),
                name: "rawResult".into(),
                value_type: "bool".into(),
            },
            Capability {
                kind: "actuator".into(),
                name: "finiteResult".into(),
                value_type: "bool".into(),
            },
            Capability {
                kind: "actuator".into(),
                name: "measuredResult".into(),
                value_type: "bool".into(),
            },
        ];
        let accept =
            |bytes: &[u8], _: &TargetLoaderContext<'_>| -> std::result::Result<bool, String> {
                ghostflow_core::Module::load(bytes)
                    .map(|_| true)
                    .map_err(|error| error.to_string())
            };
        let mut current = profile(&accept);
        current.available_capabilities = &capabilities;
        verify_portable_package(&fixture_for("debounce-valid"), &current).unwrap();
        let called = std::cell::Cell::new(false);
        let reject = |_: &[u8], _: &TargetLoaderContext<'_>| -> std::result::Result<bool, String> {
            called.set(true);
            Ok(true)
        };
        current.target_loader = &reject;
        for scenario in [
            "debounce-duration-missing",
            "debounce-duration-zero",
            "debounce-duration-fraction",
            "debounce-extra-field",
            "debounce-role-missing",
            "debounce-role-wrong",
            "debounce-enum-missing",
            "debounce-enum-duplicate",
            "debounce-enum-initial",
            "debounce-error-type",
            "debounce-source-unknown",
            "debounce-source-tag-zero",
            "debounce-source-duplicate",
            "debounce-source-states-missing",
            "debounce-source-id-missing",
            "debounce-source-epoch-name",
            "debounce-source-state-extra",
            "debounce-source-history-alias",
            "debounce-sample-missing",
            "debounce-sample-wrong",
            "debounce-descriptors-deleted",
            "debounce-bytecode-default",
            "debounce-bytecode-state-name",
            "debounce-bytecode-sample-name",
            "debounce-bytecode-source-id-default",
            "debounce-bytecode-source-epoch-default",
            "debounce-bytecode-source-state-name",
        ] {
            let error = verify_portable_package(&fixture_for(scenario), &current).unwrap_err();
            assert_eq!(
                error.code,
                ErrorCode::ManifestMismatch,
                "{scenario}: {error:?}"
            );
            assert!(!called.get(), "{scenario} reached the target loader");
        }
    }

    #[test]
    fn signed_result_sensor_metadata_is_validated_before_loader() {
        let capabilities = vec![
            Capability {
                kind: "sensor".into(),
                name: "probe".into(),
                value_type: "number".into(),
            },
            Capability {
                kind: "actuator".into(),
                name: "dry".into(),
                value_type: "bool".into(),
            },
            Capability {
                kind: "actuator".into(),
                name: "held".into(),
                value_type: "bool".into(),
            },
        ];
        let accept =
            |_: &[u8], context: &TargetLoaderContext<'_>| -> std::result::Result<bool, String> {
                assert_eq!(
                    context.manifest["sensors"][0]["faultInput"],
                    "__gf_sensor_fault_probe"
                );
                assert_eq!(
                    context.manifest["signals"][0]["faultInput"],
                    "__gf_signal_fault_stable"
                );
                Ok(true)
            };
        let mut current = profile(&accept);
        current.available_capabilities = &capabilities;
        verify_portable_package(&fixture_for("result-valid"), &current).unwrap();
        let reject = |_: &[u8], _: &TargetLoaderContext<'_>| -> std::result::Result<bool, String> {
            panic!("invalid fault source must reject before loader")
        };
        current.target_loader = &reject;
        for scenario in [
            "result-sensor-missing",
            "result-signal-missing",
            "result-sensor-wrong",
            "result-signal-wrong",
            "result-sensor-collision",
            "result-signal-collision",
        ] {
            let error = verify_portable_package(&fixture_for(scenario), &current).unwrap_err();
            assert_eq!(
                error.code,
                ErrorCode::ManifestMismatch,
                "{scenario}: {error:?}"
            );
        }
    }

    #[test]
    fn target_loader_panic_is_reported_as_rejection() {
        let bytes = fixture();
        let panic_loader =
            |_bytes: &[u8],
             _context: &TargetLoaderContext<'_>|
             -> std::result::Result<bool, String> { panic!("invalid bytecode") };
        assert_eq!(
            verify_portable_package(&bytes, &profile(&panic_loader))
                .unwrap_err()
                .code,
            ErrorCode::BytecodeRejected
        );
    }

    #[test]
    fn verifier_profile_rejects_invalid_unused_entries() {
        let bytes = fixture();
        let loader = |_bytes: &[u8],
                      _context: &TargetLoaderContext<'_>|
         -> std::result::Result<bool, String> { Ok(true) };
        let mut invalid = profile(&loader);
        invalid.supported_runtime_abis = Box::leak(Box::new(strings(&[
            "GhostFlow/framed-scan-abi-v1",
            "not valid!",
        ])));
        assert_eq!(
            verify_portable_package(&bytes, &invalid).unwrap_err().code,
            ErrorCode::InvalidIdentity
        );
    }

    #[test]
    fn encoded_artifact_limit_is_checked_before_decode() {
        assert_eq!(
            decode_base64("AAAA", "artifact", 1).unwrap_err().code,
            ErrorCode::ArtifactTooLarge
        );
    }

    #[test]
    fn source_filename_limit_matches_ecmascript_utf16_units() {
        let filename = format!("{}{}.ghost.md", "가".repeat(246), "a");
        assert_eq!(filename.encode_utf16().count(), 256);
        assert!(require_source_filename(&filename, "filename").is_ok());
    }

    #[test]
    fn empty_transport_is_rejected_without_panicking() {
        let loader =
            |_bytes: &[u8],
             _context: &TargetLoaderContext<'_>|
             -> std::result::Result<bool, String> { panic!("loader must not run") };
        assert_eq!(
            verify_portable_package(&[], &profile(&loader))
                .unwrap_err()
                .code,
            ErrorCode::InvalidTransport
        );
    }

    #[test]
    fn canonical_numbers_follow_ecmascript_spelling() {
        let value: Value =
            serde_json::from_str(r#"{"fixed":0.000001,"negativeZero":-0.0,"scientific":1e-7}"#)
                .unwrap();
        assert_eq!(
            canonical_json(&value, VerifierLimits::default()).unwrap(),
            br#"{"fixed":0.000001,"negativeZero":0,"scientific":1e-7}"#
        );
    }
}
