#!/usr/bin/env python3
"""Online per-repository build allocation; never modifies the source checkout."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlsplit
import uuid

REF = 'refs/heads/build-counter'
CONTEXT = 'FARM_BUILD_CONTEXT'
FIELDS = {'schema', 'repo', 'sourceSHA', 'baseVersion', 'buildNumber', 'buildVersion'}
SHA = re.compile(r'[0-9a-f]{40}|[0-9a-f]{64}')
VERSION = re.compile(r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)')


class Failure(Exception):
    pass


class Git:
    def __init__(self, root, log, auth=None):
        self.root, self.log, self.auth = root, log, auth or []

    def run(self, *args, data=None, check=True, log_output=True):
        env = dict(os.environ, GIT_TERMINAL_PROMPT='0',
                   GIT_AUTHOR_NAME='Build allocator', GIT_AUTHOR_EMAIL='build@localhost',
                   GIT_COMMITTER_NAME='Build allocator', GIT_COMMITTER_EMAIL='build@localhost')
        # Inherited Git repository/index overrides must not target the source checkout.
        for key in ('GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES'):
            env.pop(key, None)
        if self.auth:
            env['GIT_CONFIG_COUNT'] = str(len(self.auth))
            for i, (key, value) in enumerate(self.auth):
                env[f'GIT_CONFIG_KEY_{i}'] = key
                env[f'GIT_CONFIG_VALUE_{i}'] = value
        try:
            result = subprocess.run(['git', '-C', str(self.root), *args], input=data,
                                    text=True, capture_output=True, env=env, timeout=60)
        except subprocess.TimeoutExpired as exc:
            self.log.write('Git operation timed out\n')
            raise Failure('Git operation timed out') from exc
        if log_output:
            self.log.write(result.stdout + result.stderr)
        self.log.flush()
        if check and result.returncode:
            raise Failure('Git operation failed; build was not started')
        return result

    def value(self, *args, **kwargs):
        return self.run(*args, **kwargs).stdout.strip()


def authority_identity(url, root):
    """Canonical host/repository identity independent of SSH/HTTPS transport."""
    if '://' in url:
        parsed = urlsplit(url)
        if parsed.scheme == 'file':
            if parsed.netloc not in ('', 'localhost'):
                raise Failure('Nonlocal file authority is unsupported')
            path = str(Path(parsed.path).resolve())
            return 'file:' + path, path
        if parsed.scheme not in ('http', 'https', 'ssh', 'git') or not parsed.hostname:
            raise Failure('Unsupported build authority URL')
        host, path = parsed.hostname.lower(), parsed.path
    elif re.match(r'[^/]+:', url):
        host, path = url.split(':', 1)
        host = host.rsplit('@', 1)[-1].lower()
    else:
        path = str((Path(root) / url).resolve())
        return 'file:' + path, path
    path = path.strip('/')
    if path.endswith('.git'):
        path = path[:-4]
    if not path or '?' in path or '#' in path:
        raise Failure('Invalid authority repository path')
    return host + '/' + path, url


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n'


def validate(identity):
    if not isinstance(identity, dict) or set(identity) != FIELDS or identity['schema'] != 1:
        raise Failure('Invalid build identity schema')
    if (not isinstance(identity['repo'], str) or not identity['repo'] or any(c.isspace() for c in identity['repo'])
            or not isinstance(identity['sourceSHA'], str) or not SHA.fullmatch(identity['sourceSHA'])
            or not isinstance(identity['baseVersion'], str) or not VERSION.fullmatch(identity['baseVersion'])
            or type(identity['buildNumber']) is not int or identity['buildNumber'] < 1
            or identity['buildVersion'] != f"{identity['baseVersion']}-build.{identity['buildNumber']}"):
        raise Failure('Invalid build identity fields')
    return identity


def read_counter(git, commit):
    if not isinstance(commit, str) or not SHA.fullmatch(commit):
        raise Failure('Invalid counter commit')
    if git.value('ls-tree', '--name-only', commit) != 'counter.json':
        raise Failure('Counter tree must contain only counter.json')
    try:
        identity = validate(json.loads(git.value('show', f'{commit}:counter.json')))
    except (ValueError, TypeError) as exc:
        raise Failure('Invalid counter JSON') from exc
    parents = git.value('show', '-s', '--format=%P', commit).split()
    if len(parents) > 1:
        raise Failure('Counter history must be linear')
    if not parents:
        if identity['buildNumber'] != 1:
            raise Failure('First counter must be one')
    else:
        try:
            previous = validate(json.loads(git.value('show', f'{parents[0]}:counter.json')))
        except (ValueError, TypeError) as exc:
            raise Failure('Invalid preceding counter') from exc
        if identity['repo'] != previous['repo'] or identity['buildNumber'] != previous['buildNumber'] + 1:
            raise Failure('Counter must advance by exactly one')
    return identity


def head(git, authority):
    lines = git.value('ls-remote', '--refs', authority, REF).splitlines()
    if not lines:
        return ''
    if len(lines) != 1 or lines[0].split()[1] != REF:
        raise Failure('Invalid counter reference response')
    commit = lines[0].split()[0]
    if not SHA.fullmatch(commit):
        raise Failure('Invalid counter reference')
    git.run('fetch', '--no-tags', authority, commit)
    return commit


def allocate(git, authority, repo, source, base, inherited, inherit_only=False):
    if inherited:
        try:
            context = json.loads(inherited)
            identity = validate(context['identity'])
        except (ValueError, TypeError, KeyError) as exc:
            raise Failure('Invalid inherited build context') from exc
        if identity['repo'] == repo:
            if identity['sourceSHA'] != source or identity['baseVersion'] != base:
                raise Failure('Inherited identity does not match this build')
            parent_store = context.get('metadataStore')
            if not isinstance(parent_store, str) or not Path(parent_store).is_dir():
                raise Failure('Inherited metadata store is no longer available')
            issued = read_counter(Git(parent_store, git.log), context.get('counterCommit'))
            if issued != identity:
                raise Failure('Inherited identity was not issued by current authority')
            return context
    if inherit_only:
        raise Failure('This internal step requires a valid same-repository parent build context')
    expected = head(git, authority)
    for attempt in range(12):
        number = 1
        if expected:
            previous = read_counter(git, expected)
            if previous['repo'] != repo:
                raise Failure('Counter belongs to a different repository')
            number = previous['buildNumber'] + 1
        identity = dict(schema=1, repo=repo, sourceSHA=source, baseVersion=base,
                        buildNumber=number, buildVersion=f'{base}-build.{number}')
        blob = git.value('hash-object', '-w', '--stdin', data=encode(identity))
        tree = git.value('mktree', data=f'100644 blob {blob}\tcounter.json\n')
        args = ['commit-tree', tree]
        if expected:
            args += ['-p', expected]
        commit = git.value(*args, data=f'Allocate build {number}\nAttempt {uuid.uuid4().hex}\n')
        result = git.run('push', '--porcelain', f'--force-with-lease={REF}:{expected}',
                         authority, f'{commit}:{REF}', check=False)
        if result.returncode == 0:
            return dict(identity=identity, counterCommit=commit, metadataStore=str(git.root))
        latest = head(git, authority)
        if latest == expected:
            raise Failure('Counter write rejected; build was not started')
        expected = latest
        time.sleep(min(0.02 * (attempt + 1), 0.2))
    raise Failure('Counter contention retry limit reached; build was not started')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', default='.', help='Source repository directory')
    parser.add_argument('--remote', default='origin', help='Configured single fetch/push authority')
    parser.add_argument('--base-version', required=True, help='Version supplied by existing build configuration')
    parser.add_argument('--inherit-only', action='store_true', help='Internal step: require a valid same-repository parent context, never allocate')
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    if not command or not VERSION.fullmatch(args.base_version):
        parser.error('A configured base version and build command are required')
    fd, log_path = tempfile.mkstemp(prefix='farm-build-git-', suffix='.log')
    try:
        with os.fdopen(fd, 'w') as log, tempfile.TemporaryDirectory(prefix='farm-build-counter-') as store:
            source_git = Git(Path(args.repo).resolve(), log)
            root = source_git.value('rev-parse', '--show-toplevel')
            source = source_git.value('rev-parse', 'HEAD')
            urls = source_git.value('remote', 'get-url', '--all', args.remote).splitlines()
            push_urls = source_git.value('remote', 'get-url', '--push', '--all', args.remote).splitlines()
            if len(urls) != 1 or len(push_urls) != 1:
                raise Failure('Build authority requires one fetch and one push URL')
            repo, _ = authority_identity(urls[0], root)
            push_repo, authority = authority_identity(push_urls[0], root)
            if push_repo != repo:
                raise Failure('Fetch/push authorities refer to different repositories')
            # Checkout credentials (e.g. Actions extraheader) are repository-local.
            # Pass selected auth via environment, never argv, disk, or diagnostic output.
            auth_result = source_git.run('config', '--null', '--get-regexp',
                r'^(http\..*\.extraheader|credential\..*|core\.sshcommand)$',
                check=False, log_output=False)
            if auth_result.returncode not in (0, 1):
                raise Failure('Cannot read configured build authentication')
            auth = [tuple(item.split('\n', 1)) for item in auth_result.stdout.split('\0') if item]
            git = Git(store, log, auth)
            git.run('init', '--quiet')
            context = allocate(git, authority, repo, source, args.base_version, os.environ.get(CONTEXT), args.inherit_only)
            identity = context['identity']
            path = Path(store) / 'build-identity.json'
            path.write_text(encode(identity))
            env = dict(os.environ, **{CONTEXT: encode(context),
                       'FARM_BUILD_IDENTITY_FILE': str(path),
                       'FARM_BUILD_VERSION': identity['buildVersion']})
            print(f"Build {identity['buildVersion']}", flush=True)
            result = subprocess.run(command, env=env)
            if result.returncode == 0:
                Path(log_path).unlink()
            return result.returncode if result.returncode >= 0 else 128 - result.returncode
    except (Failure, OSError) as exc:
        # Git diagnostics can include credentials in URLs. Retain them only in private log.
        print(f'Build identity: {exc}. Private Git log: {log_path}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
