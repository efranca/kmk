import pytest

from app import names


@pytest.mark.parametrize(
    "raw",
    ["Marie Tremblay", "Élise-Anne O'Brien", "Jean-François de la Fontaine", "李 明", "Zoë D’Amour", "J. R. R. Tolkien", "Ana 2"],
)
def test_ordinary_names_are_accepted(raw):
    assert names.clean_name(raw) == raw


def test_names_are_normalized_and_tidied():
    assert names.clean_name("  Marie   Tremblay ") == "Marie Tremblay"
    assert names.clean_name("Zoë") == "Zoë"  # decomposed accent becomes the single composed character (NFC)


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "   ",
        "x" * 101,
        "Marie\nTremblay",
        "Marie\tTremblay",
        "Marie​Tremblay",  # zero-width space
        "Marie‮Tremblay",  # right-to-left override (display spoofing)
        "Marie\x00",
        "<b>Marie</b>",
        "marie@example.com",
        '"Marie"',
        "Marie/Tremblay",
        "Marie & Co",
    ],
)
def test_unsafe_or_invalid_names_are_refused(raw):
    with pytest.raises(ValueError):
        names.clean_name(raw)


def test_the_length_limit_is_100_after_cleaning():
    assert len(names.clean_name("x" * 100)) == 100
    assert names.clean_name("  " + "x" * 100 + "  ") == "x" * 100


def test_fold_ignores_accents_and_capitals():
    assert names.fold("Élise") == names.fold("elise") == names.fold("ÉLISE") == "elise"
    assert names.fold("  Jean   François ") == "jean francois"


def test_sort_key_uses_the_name_or_falls_back_to_the_username():
    people = [("Émile", "e"), ("Zoé", "z"), ("anne", "a"), (None, "bea")]
    ordered = sorted(people, key=lambda p: names.sort_key(*p))
    assert [p[1] for p in ordered] == ["a", "bea", "e", "z"]  # anne, bea, Émile, Zoé
    assert names.sort_key(None, "BOB")[0] == "bob"  # a missing name sorts by the folded username
