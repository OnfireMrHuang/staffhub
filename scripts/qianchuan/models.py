"""Resolved business identity travels with the batch, including empty results."""
from dataclasses import dataclass
from scripts.utils.model import Batch


@dataclass
class ReportBatch(Batch):
    # None: unresolved; empty string: advertiser total; otherwise internal ID.
    aweme_id: str | None = None
