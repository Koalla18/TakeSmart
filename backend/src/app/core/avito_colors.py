"""Цвета каталога Авито: названия поставщиков, локализация и разбор реплик."""

import re
from collections import defaultdict
from functools import lru_cache

# Цвет как пишут в прайсе (и с опечатками) → (как называется, по-русски)
COLORS = {
    "black": ("Black", "чёрный"), "white": ("White", "белый"), "while": ("White", "белый"),
    "blue": ("Blue", "синий"), "silver": ("Silver", "серебристый"), "orange": ("Orange", "оранжевый"),
    "gold": ("Gold", "золотой"), "pink": ("Pink", "розовый"), "teal": ("Teal", "бирюзовый"),
    "ultramarine": ("Ultramarine", "ультрамарин"), "lavender": ("Lavender", "лавандовый"), "sage": ("Sage", "шалфей, зелёный"),
    "yellow": ("Yellow", "жёлтый"), "desert": ("Desert", "песочный"), "natural": ("Natural", "натуральный титан"),
    "night sky": ("Night Sky", "ночное небо, тёмно-синий"), "nightsky": ("Night Sky", "ночное небо, тёмно-синий"),
    "burg": ("Burgundy", "бордовый"), "burgundy": ("Burgundy", "бордовый"), "green": ("Green", "зелёный"),
    "purple": ("Purple", "фиолетовый"), "red": ("Red", "красный"), "gray": ("Gray", "серый"), "grey": ("Gray", "серый"),
    "space gray": ("Space Gray", "серый космос"), "space grey": ("Space Gray", "серый космос"),
    "space black": ("Space Black", "чёрный космос"), "starlight": ("Starlight", "сияющая звезда"),
    "midnight": ("Midnight", "тёмная ночь"), "titanium": ("Titanium", "титан"), "graphite": ("Graphite", "графит"),
    "glacier": ("Glacier", "ледник, голубой"), "cream": ("Cream", "кремовый"), "pistachio": ("Pistachio", "фисташковый"),
    "violet": ("Violet", "фиолетовый"), "cobalt violet": ("Cobalt Violet", "фиолетовый"),
    "light violet": ("Light Violet", "светло-фиолетовый"), "light pink": ("Light Pink", "светло-розовый"),
    "l.blue": ("Light Blue", "голубой"), "sky blue": ("Sky Blue", "небесно-голубой"), "jet black": ("Jet Black", "чёрный"),
    "jetblack": ("Jet Black", "чёрный"), "rose gold": ("Rose Gold", "розовое золото"), "bronze": ("Bronze", "бронзовый"),
    "indigo": ("Indigo", "индиго"), "blush": ("Blush", "нежно-розовый"), "citrus": ("Citrus", "цитрусовый, жёлтый"),
    "obsidian": ("Obsidian", "чёрный"), "snow": ("Snow", "белый"), "frost": ("Frost", "голубой"),
    "hibiscus": ("Hibiscus", "красный"), "fog": ("Fog", "серо-зелёный"), "canyon": ("Canyon", "терракотовый"),
    "olive": ("Olive", "оливковый"), "berry": ("Berry", "ягодный"), "mint": ("Mint", "мятный"), "navy": ("Navy", "тёмно-синий"),
    "silver shadow": ("Silver Shadow", "серебристый"), "icyblue": ("Icy Blue", "голубой"), "lilac": ("Lilac", "сиреневый"),
    "blueberry": ("Blueberry", "синий"), "a.gray": ("Gray", "серый"), "a.black": ("Black", "чёрный"),
    "a.icyblue": ("Icy Blue", "голубой"), "a.lilac": ("Lilac", "сиреневый"), "a.navy": ("Navy", "тёмно-синий"),
    "titanium black": ("Titanium Black", "чёрный титан"), "black titanium": ("Titanium Black", "чёрный титан"),
    "titanium gray": ("Titanium Gray", "серый титан"), "gray titanium": ("Titanium Gray", "серый титан"),
    "natural titanium": ("Natural", "натуральный титан"), "blue titanium": ("Blue Titanium", "синий титан"),
    "white titanium": ("White Titanium", "белый титан"), "desert titanium": ("Desert Titanium", "пустынный титан"),
    "titanium silverblue": ("Titanium SilverBlue", "серо-голубой титан"),
    "titanium whitesilver": ("Titanium WhiteSilver", "бело-серебристый титан"),
    "cosmic orange": ("Cosmic Orange", "оранжевый"), "deep blue": ("Deep Blue", "синий"), "cloud white": ("Cloud White", "белый"),
    "mist blue": ("Mist Blue", "голубой"), "light gold": ("Light Gold", "золотой"),
    "ceramic pink": ("Ceramic Pink", "розовый"), "jasper plum": ("Jasper Plum", "сливовый"),
    "apricot topaz": ("Apricot Topaz", "абрикосовый"), "prussian blue": ("Prussian Blue", "синий"),
    "черный": ("Black", "чёрный"), "чёрный": ("Black", "чёрный"), "белый": ("White", "белый"),
    "фиолетовый": ("Violet", "фиолетовый"), "синий": ("Blue", "синий"), "серый": ("Gray", "серый"),
    "сияющая звезда": ("Starlight", "сияющая звезда"),
    "серый космос": ("Space Gray", "серый космос"),
    "космический серый": ("Space Gray", "серый космос"),
    "черный космос": ("Space Black", "чёрный космос"), "чёрный космос": ("Space Black", "чёрный космос"),
}

_WORD = re.compile(r"[^\W_]+", re.UNICODE)


def _normalize(text: str) -> str:
    return " ".join(_WORD.findall(text.casefold().replace("ё", "е")))


_LABELS = {_normalize(name): (name, label) for name, label in COLORS.values()}
# Official keys are also accepted when the supplier used an abbreviation such as «A.IcyBlue».
COLORS.update(_LABELS)


def _build_vocabulary() -> dict[str, set[str]]:
    vocabulary: dict[str, set[str]] = defaultdict(set)
    for alias, (official, translated) in COLORS.items():
        key = _normalize(official)
        vocabulary[_normalize(alias)].add(key)
        for label in [translated, *translated.split(",")]:
            label = _normalize(label)
            vocabulary[label].add(key)
    # A generic description can cover several catalog finishes. More specific labels and
    # official English names keep their own candidate sets.
    generic_hues = {"черный", "белый", "синий", "голубой", "серый", "зеленый", "розовый",
                    "фиолетовый", "желтый", "золотой", "серебристый", "красный", "оранжевый"}
    for key, (_, translated) in _LABELS.items():
        for hue in generic_hues.intersection(_normalize(translated).split()):
            vocabulary[hue].add(key)
    for alias, label in {"серебро": "серебристый", "оранж": "оранжевый",
                         "титановый": "титан", "графитовый": "графит",
                         "космический черный": "черный космос"}.items():
        vocabulary[alias].update(vocabulary[label])

    # Pair any accepted supplier spelling with a compatible Russian label, in either
    # order. «Space Grey (серый)» is a specific finish even when «серый» is ambiguous.
    translations = {label: choices for label, choices in vocabulary.items() if re.search("[а-я]", label)}
    for alias, (official, _) in COLORS.items():
        if alias.isascii():
            key = _normalize(official)
            for label, shades in translations.items():
                if key in shades:
                    english = _normalize(alias)
                    vocabulary[f"{english} {label}"].add(key)
                    vocabulary[f"{label} {english}"].add(key)
    return dict(vocabulary)


_VOCAB = _build_vocabulary()
_LOCALIZED = {_normalize(part): part.strip() for _, label in _LABELS.values() for part in label.split(",")}
# Build only inflected forms of words that actually occur in a color name.
# This avoids matching «сервер» as «серый» or «краснодар» as «красный».
_ADJECTIVE_ENDINGS = {
    "ый": "ая ое ые ой ую ого ому ым ом ых ыми",
    "ой": "ая ое ые ую ого ому ым ом ых ыми",
    "ий": "яя ее ие юю его ему им ем их ими ей",
    "ая": "ой ую",
    "ое": "ого ому ом ым",
}


def _word_forms() -> dict[str, str]:
    forms = {}
    words = {word for label in _VOCAB for word in label.split()}
    for word in sorted(words):
        if not re.fullmatch(r"[а-я]+", word):
            continue
        ending = word[-2:]
        if ending in _ADJECTIVE_ENDINGS:
            endings = _ADJECTIVE_ENDINGS[ending]
            if word.endswith("ский"):
                endings = "ая ое ие ую ого ому им ом их ими ой"
            for suffix in endings.split():
                forms[word[:-2] + suffix] = word
    nouns = {"звезда": "звезды звезде звезду звездой", "ночь": "ночи ночью",
             "небо": "неба небу небом небе", "титан": "титана титане титаном",
             "космос": "космоса космосе космосом", "золото": "золота золоте золотом",
             "серебро": "серебра серебре серебром", "графит": "графита графите графитом",
             "шалфей": "шалфея шалфее шалфеем", "ультрамарин": "ультрамарина ультрамарине ультрамарином"}
    for noun, variants in nouns.items():
        forms.update(dict.fromkeys(variants.split(), noun))
    # Nominatives take precedence over accidental intersections of inflection tables.
    forms.update({word: word for word in words})
    return forms


_FORMS = _word_forms()
_PREFIX_LENGTH: dict[str, int] = {}
for _alias in _VOCAB:
    _words = _alias.split()
    _PREFIX_LENGTH[_words[0]] = max(_PREFIX_LENGTH.get(_words[0], 0), len(_words))


def _phrase(words: list[str]) -> str:
    return " ".join(_FORMS.get(word, word) for word in words)


def _matched_key(phrase: str) -> str:
    candidates = _VOCAB[phrase]
    return next(iter(candidates)) if len(candidates) == 1 else phrase


@lru_cache(maxsize=4096)
def color_key(value: str) -> str:
    """Официальный оттенок или общее название покупателя, если перевод неоднозначен."""
    label = _normalize(value)
    phrase = _phrase(label.split())
    return _matched_key(phrase) if phrase in _VOCAB else label


def color_candidates(value: str) -> set[str]:
    """Возможные оттенки для одного названия. Незнакомые значения сравниваются буквально."""
    key = color_key(value)
    return set(_VOCAB.get(key, (key,))) if key else set()


def color_label(value: str) -> tuple[str, str | None]:
    key = color_key(value)
    if key in _LABELS:
        return _LABELS[key]
    return _LOCALIZED.get(key, value), None


def color_spans(text: str) -> list[tuple[int, int, str]]:
    """Самые длинные полные названия; смещения относятся к исходной строке."""
    tokens = list(_WORD.finditer(text))
    words = [token[0].lower().replace("ё", "е") for token in tokens]
    words = [_FORMS.get(word, word) for word in words]
    found = []
    index = 0
    while index < len(tokens):
        length = _PREFIX_LENGTH.get(words[index], 0)
        for end in range(min(index + length, len(tokens)), index, -1):
            phrase = " ".join(words[index:end])
            if phrase in _VOCAB:
                found.append((tokens[index].start(), tokens[end - 1].end(), _matched_key(phrase)))
                index = end
                break
        else:
            index += 1
    return found


def color_mentions(text: str) -> list[str]:
    return list(dict.fromkeys(key for _, _, key in color_spans(text)))
