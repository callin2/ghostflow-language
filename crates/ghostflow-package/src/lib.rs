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
            if capability.value_type != "bool" && capability.value_type != "number" {
                return fail(
                    ErrorCode::InvalidCapabilities,
                    format!("{label}[{index}].type must be bool or number"),
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

fn validate_gfb1(bytes: &[u8]) -> Result<()> {
    if bytes.len() < 6 || &bytes[..4] != b"GFB1" {
        return fail(ErrorCode::InvalidBytecodeFormat, "bytecode is not GFB1");
    }
    if bytes[4] != 1 || bytes[5] != 0 {
        return fail(
            ErrorCode::UnsupportedBytecodeVersion,
            "only GFB1 format version 1 is supported",
        );
    }
    Ok(())
}

fn manifest_capability_type(value: &str, label: &str) -> Result<&'static str> {
    match value {
        "Bool" => Ok("bool"),
        "Number" | "Percent" | "Duration" => Ok("number"),
        _ => fail(
            ErrorCode::ManifestMismatch,
            format!("{label} is unsupported"),
        ),
    }
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
            exact_keys(
                port,
                &["name", "type"],
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
    let root = parse_canonical_transport(transport, profile.limits)?;
    let envelope: Envelope = parse_wire(root, "package")?;
    if envelope.format != PACKAGE_FORMAT {
        return fail(
            ErrorCode::UnsupportedPackageFormat,
            "package format is unsupported",
        );
    }
    require_digest(&envelope.payload_sha256, "package.payloadSha256")?;
    if envelope.signatures.is_empty() || envelope.signatures.len() > profile.limits.max_signatures {
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

    let accepted_key_ids = verify_signatures(&envelope.signatures, &payload_bytes, profile)?;
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
    if payload.bytecode.version != "1" {
        return fail(
            ErrorCode::UnsupportedBytecodeVersion,
            "payload bytecode version must be 1",
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
    validate_gfb1(&bytecode)?;
    let source_text = String::from_utf8(source_bytes).map_err(|_| PortablePackageError {
        code: ErrorCode::InvalidUtf8,
        message: "source must be well-formed UTF-8".into(),
    })?;
    let manifest = parse_embedded_canonical_json(&manifest_bytes, "manifest", profile.limits)?;
    let source_map = parse_embedded_canonical_json(&source_map_bytes, "sourceMap", profile.limits)?;
    verify_manifest(
        &manifest,
        &payload.manifest.format,
        &bytecode_sha256,
        &identity.required_capabilities,
    )?;
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
        let signature_bytes = decode_base64(
            &signature.signature_base64,
            "signatures.signatureBase64",
            256,
        )?;
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
        let abis = Box::leak(Box::new(strings(&["GhostFlow/framed-scan-abi-v1"])));
        let manifests = Box::leak(Box::new(strings(&["GhostFlow/control-v1"])));
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
