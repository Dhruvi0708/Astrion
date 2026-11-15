"""Lexical retrieval (Okapi BM25) used by memory recall and evidence targeting.

Deliberately dependency-free and deterministic: no embeddings service is required, results are
reproducible, and scores are explainable ("matched terms: warming, bleaching").
"""

import math
import re
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass

_WORD = re.compile(r"[a-z0-9][a-z0-9-]{1,}")
STOPWORDS = frozenset(
    """a about above after again against all also am an and any are as at be because been before being below between both but by can
    could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it
    its itself just me more most my no nor not now of off on once only or other our out over own same she should so some such than that
    the their them then there these they this those through to too under until up very was we were what when where which while who whom
    why will with would you your""".split()
)


def tokens(text: str) -> list[str]:
    out = []
    for w in _WORD.findall(text.lower()):
        if w in STOPWORDS or w.isdigit():
            continue
        if len(w) > 4 and w.endswith("s") and not w.endswith("ss"):
            w = w[:-1]
        out.append(w)
    return out


def jaccard(a: str, b: str) -> float:
    ta, tb = set(tokens(a)), set(tokens(b))
    return len(ta & tb) / len(ta | tb) if ta and tb else 0.0


@dataclass(frozen=True)
class Hit:
    index: int
    score: float
    matched: tuple[str, ...]


class BM25:
    def __init__(self, documents: Sequence[str], k1: float = 1.4, b: float = 0.75) -> None:
        self.docs = [tokens(d) for d in documents]
        self.tf = [Counter(d) for d in self.docs]
        self.k1, self.b = k1, b
        n = len(self.docs)
        self.avgdl = (sum(len(d) for d in self.docs) / n) if n else 0.0
        df: Counter[str] = Counter()
        for d in self.docs:
            df.update(set(d))
        self.idf = {t: math.log(1 + (n - f + 0.5) / (f + 0.5)) for t, f in df.items()}

    def search(self, query: str, limit: int | None = None, min_score: float = 0.0, min_matched: int = 1) -> list[Hit]:
        """Ranked hits. `min_matched` = distinct query terms a document must share (robust for small corpora,
        where absolute BM25 scores are low because common terms carry little weight)."""
        q = set(tokens(query))
        min_matched = min(min_matched, len(q)) if q else min_matched
        hits = []
        for i, (doc, tf) in enumerate(zip(self.docs, self.tf, strict=True)):
            matched = tuple(sorted(t for t in q if t in tf))
            if not matched or len(matched) < min_matched:
                continue
            dl = len(doc) or 1
            score = 0.0
            for t in matched:
                f = tf[t]
                score += self.idf[t] * f * (self.k1 + 1) / (f + self.k1 * (1 - self.b + self.b * dl / (self.avgdl or 1)))
            if score > min_score:
                hits.append(Hit(i, round(score, 4), matched))
        hits.sort(key=lambda h: (-h.score, h.index))
        return hits[:limit] if limit else hits
