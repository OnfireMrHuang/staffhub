"""Compatibility executable for the autonomous marketing module."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.marketing.cli import main

if __name__ == '__main__':
    raise SystemExit(main())
