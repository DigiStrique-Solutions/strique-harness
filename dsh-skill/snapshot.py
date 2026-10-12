"""Copy a bounded source through directory descriptors. Never follow source links.

Python's dir_fd/openat support closes the directory-replacement race that Node's
path-only filesystem API cannot close on macOS. No source code is executed.
"""
import os
import stat
import sys

MAX_BYTES = 32 * 1024 * 1024
MAX_FILE = 4 * 1024 * 1024
MAX_ENTRIES = 4096
SKIP = {'.git', 'node_modules', '__pycache__'}
flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
budget = [0, 0]


def directory(path):
    # Anchor every component, including ancestors, before reading any bytes.
    fd = os.open('/', flags | os.O_DIRECTORY)
    try:
        for part in os.path.abspath(path).split('/')[1:]:
            if not part:
                continue
            child = os.open(part, flags | os.O_DIRECTORY, dir_fd=fd)
            os.close(fd)
            fd = child
        return fd
    except BaseException:
        os.close(fd)
        raise


def copy_tree(src, dest, depth=0):
    if depth > 16:
        raise ValueError('source exceeds maximum directory depth (16)')
    for name in sorted(os.listdir(src)):
        if name in SKIP:
            continue
        budget[0] += 1
        if budget[0] > MAX_ENTRIES:
            raise ValueError('source exceeds maximum entries (4096)')
        before = os.stat(name, dir_fd=src, follow_symlinks=False)
        if not (stat.S_ISDIR(before.st_mode) or stat.S_ISREG(before.st_mode)):
            raise ValueError('symlinks and special files are not supported')
        fd = os.open(name, flags | (os.O_DIRECTORY if stat.S_ISDIR(before.st_mode) else 0), dir_fd=src)
        try:
            opened = os.fstat(fd)
            if (opened.st_dev, opened.st_ino, opened.st_mode) != (before.st_dev, before.st_ino, before.st_mode):
                raise ValueError('source changed while being copied')
            target = os.path.join(dest, name)
            if stat.S_ISDIR(opened.st_mode):
                os.mkdir(target, 0o700)
                copy_tree(fd, target, depth + 1)
            else:
                if name == '.gitmodules' and opened.st_size:
                    raise ValueError('Git submodules are not supported; use a local export with materialized assets and no .gitmodules file')
                if opened.st_size > MAX_FILE or budget[1] + opened.st_size > MAX_BYTES:
                    raise ValueError('source exceeds file (4 MiB) or total (32 MiB) byte limit')
                size = 0
                with open(target, 'xb') as output:
                    while True:
                        chunk = os.read(fd, 65536)
                        if not chunk:
                            break
                        if size == 0 and chunk.startswith(b'version https://git-lfs.github.com/spec/v1\n'):
                            raise ValueError('unresolved Git LFS asset; materialize LFS files in a local export before importing')
                        size += len(chunk)
                        budget[1] += len(chunk)
                        if size > MAX_FILE or budget[1] > MAX_BYTES:
                            raise ValueError('source exceeds byte limit')
                        output.write(chunk)
                os.chmod(target, 0o700 if opened.st_mode & 0o111 else 0o600)
                after = os.fstat(fd)
                if (opened.st_size, opened.st_mtime_ns, opened.st_ctime_ns) != (after.st_size, after.st_mtime_ns, after.st_ctime_ns):
                    raise ValueError('source changed while being copied')
        finally:
            os.close(fd)


try:
    source = directory(sys.argv[1])
    try:
        copy_tree(source, sys.argv[2])
    finally:
        os.close(source)
except Exception as error:
    # Do not echo source paths, filenames, file content or subprocess environment.
    print(str(error) if isinstance(error, ValueError) else 'source is unavailable, changed, or contains a symlink', file=sys.stderr)
    sys.exit(1)
