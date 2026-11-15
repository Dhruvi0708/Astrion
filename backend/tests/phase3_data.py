"""Deterministic Phase 3 dataset: dated, multi-passage documents from related and independent sources.

Written so the fixture provider's keyword rules produce material for every Phase 3 feature:
updated figures (temporal supersession), conflicting periods (temporal resolution), a causal claim,
passages that only become relevant to a follow-up question (adaptive exploration), and two sources
that share an author (independence grouping).
"""

import io

FILLER = (
    "Field teams logged water clarity, transect coverage and equipment calibration notes for every dive. "
    "Logistics, permits and boat schedules are documented in the appendix and are not discussed further here. "
)


def padded(*paragraphs: str) -> str:
    # Each paragraph becomes its own ~1.4k-character passage, so documents have several chunks.
    return "\n\n".join(p + "\n" + FILLER * 12 for p in paragraphs)


SURVEY_2019 = padded(
    "Reef Survey 2019. Ocean warming increases coral bleaching across the northern reef. Bleaching affected 30 percent of surveyed sites in 2019.",
    "Herbivorous fish populations remained stable across the northern reef in 2019, with parrotfish grazing algae on damaged sections.",
    "Nutrient runoff correlates with algae growth on damaged reef sections near river mouths during the wet season of 2019.",
)
SURVEY_2023 = padded(
    "Reef Survey 2023. Ocean warming increases coral bleaching across the northern reef. Bleaching affected 61 percent of surveyed sites in 2023.",
    "Marine heatwaves cause coral bleaching when temperatures stay above the seasonal maximum for several weeks in 2023.",
    "Coral recovery depends on herbivorous fish populations that graze algae after bleaching events, according to the 2023 teams.",
)
REVIEW_2021 = padded(
    "Independent Reef Review 2021. Ocean warming does not increase coral bleaching at the southern sites, where cooler upwelling persisted from 2018 to 2020.",
    "Fishing pressure reduces herbivorous fish populations near the harbour, which slows coral recovery after bleaching.",
)

NEWS_2024 = padded(
    "Coastal News 2024. Ocean warming increases coral bleaching across the northern reef, scientists told reporters in 2024.",
)

SOURCES = [
    # title, type, authors, uri, published_on, docs
    ("Northern Reef Monitoring 2019", "report", ["A. Rivera"], "https://reefwatch.example.org/2019", "2019-12-01", [("survey-2019.txt", SURVEY_2019)]),
    ("Northern Reef Monitoring 2023", "report", ["A. Rivera"], "https://reefwatch.example.org/2023", "2023-12-01", [("survey-2023.txt", SURVEY_2023)]),
    ("Independent Reef Review", "paper", ["K. Osei"], "https://journal.example.net/review", "2021-06-01", [("review-2021.txt", REVIEW_2021)]),
    # Independent outlet restating the survey finding: corroboration from a different source group.
    ("Coastal News", "article", ["M. Chen"], "https://news.example.com/reef", "2024-01-15", [("news-2024.txt", NEWS_2024)]),
]

QUESTION_1 = "Does ocean warming increase coral bleaching on the reef?"
QUESTION_2 = "How do herbivorous fish populations affect coral recovery after bleaching?"


def seed(client, name: str = "Reef memory") -> dict:
    ws = client.post("/api/v1/workspaces", json={"name": name}).json()
    docs = {}
    for title, stype, authors, uri, published, files in SOURCES:
        src = client.post(
            f"/api/v1/workspaces/{ws['id']}/sources",
            json={"title": title, "source_type": stype, "authors": authors, "uri": uri, "published_on": published},
        )
        assert src.status_code == 201, src.text
        for fname, body in files:
            r = client.post(f"/api/v1/sources/{src.json()['id']}/documents/upload", files={"file": (fname, io.BytesIO(body.encode()), "text/plain")})
            assert r.status_code == 201, r.text
            docs[fname] = r.json()
    return {"ws": ws, "docs": docs}


def run(client, ws_id: str, question: str, title: str = "Investigation", doc_ids: list[str] | None = None) -> dict:
    inv = client.post(f"/api/v1/workspaces/{ws_id}/investigations", json={"title": title, "question": question, "document_ids": doc_ids or []}).json()
    detail = client.post(f"/api/v1/investigations/{inv['id']}/start").json()
    return detail
