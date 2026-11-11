"""Carry a file's properties over to the file that replaces it.

When a tool rewrites a file (compress, a toolbox fix, an upscale, a subtitle re-time, a tag
edit) the result is a brand new file, so it starts with "now" for its dates, default
permissions and none of the old file's extended attributes. Apps that watch the folder (a photo
manager, a media server) then see something new. `copy_props(old, new)` is called on the finished
temp file just before it takes the old file's place.

Best effort by design: every step is tried on its own and whatever the filesystem refuses
(ownership for a non-root user, extended attributes on SMB/NFS/FAT) is skipped. Nothing here
may fail a job. What cannot be copied at all: the creation time, the inode number and the
"changed" time, which the filesystem assigns.
"""

import logging
import os

logger = logging.getLogger(__name__)


def copy_props(old: str, new: str) -> None:
    """Give `new` the owner, permissions, extended attributes and times of `old`. Never raises."""
    try:
        st = os.stat(old, follow_symlinks=False)
    except OSError:
        return
    if not os.path.lexists(new):
        return

    # Owner first: changing it can clear permission bits that chmod then puts back.
    _try(os.chown, new, st.st_uid, st.st_gid)
    _try(os.chmod, new, st.st_mode & 0o7777)
    _copy_xattrs(old, new)
    # Times last, so nothing above can move them.
    _try(os.utime, new, ns=(st.st_atime_ns, st.st_mtime_ns))


def _copy_xattrs(old: str, new: str) -> None:
    try:
        names = os.listxattr(old)
    except (OSError, AttributeError):
        return
    for name in names:
        try:
            value = os.getxattr(old, name)
        except OSError:
            continue
        _try(os.setxattr, new, name, value)


def _try(fn, *args, **kwargs) -> None:
    try:
        fn(*args, **kwargs)
    except OSError:
        logger.debug("could not copy a file property with %s", getattr(fn, "__name__", fn))
