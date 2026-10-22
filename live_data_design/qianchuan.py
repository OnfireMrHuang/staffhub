"""Compatibility entry point; prefer scripts/qianchuan.py."""
from scripts.qianchuan.cli import main

if __name__ == '__main__':
    raise SystemExit(main())
