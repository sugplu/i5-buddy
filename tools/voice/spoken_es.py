#!/usr/bin/env python3
"""What the Spanish voice (Estrella, Deepgram Aura-2 Spanish) is sent for a unit: the unit's text with every number, ordinal,
route name, time, amount and abbreviation written out in Mexican Spanish words, so no voice reads "4,144" as a decimal or
"I-5" as "i guion cinco". The unit's own text (what the app shows and the clip's name) never changes; only the ear's copy
does. Place and other proper names stay exactly as written (the voice says them its own way).

  numbers     4,144 pies -> cuatro mil ciento cuarenta y cuatro pies; 21 millas -> veintiuna millas; 1 pie -> un pie;
              200 personas -> doscientas personas; 1806 -> mil ochocientos seis; 4.5 -> cuatro punto cinco;
              a number before a noun agrees with it (un / una, doscientos / doscientas), any other is said whole ("salida
              veintiuno", "en mil ochocientos uno"); el 1 de mayo -> el primero de mayo
  routes      la I-5 -> la interestatal cinco; I-5W -> interestatal cinco oeste; la U.S. 101 -> la u ese ciento uno;
              la Highway 99 -> la Highway noventa y nueve; OR-7, B-24 -> o erre siete, be veinticuatro
  ordinals    1.ª -> primera ... 6.ª -> sexta (the roundabouts), 11.ª -> undécima, n.º 148 -> número ciento cuarenta y ocho
  others      4:52 -> cuatro cincuenta y dos; $3.5 millones -> tres punto cinco millones de dólares; siglo XIX -> siglo
              diecinueve; Sargón II -> Sargón segundo; St. / Mt. / Ft. / Jr. / Bros. -> Saint / Mount / Fort / Junior /
              Brothers; PG&E -> pe ge y e; 9-1-1 -> nueve uno uno; 4+ -> cuatro o más; a lone exit letter "B." -> "be."
Run:  python3 tools/voice/spoken_es.py "En 2 millas, tome la salida 215 hacia la I-5."     (prints the spoken form)
      python3 tools/voice/spoken_es.py --test                                               (the checks below)
"""
import re
import sys
import unicodedata

ONES = ["cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce", "trece",
        "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve", "veinte", "veintiuno", "veintidós",
        "veintitrés", "veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve"]
TENS = {3: "treinta", 4: "cuarenta", 5: "cincuenta", 6: "sesenta", 7: "setenta", 8: "ochenta", 9: "noventa"}
HUNDREDS = {1: "ciento", 2: "doscientos", 3: "trescientos", 4: "cuatrocientos", 5: "quinientos", 6: "seiscientos",
            7: "setecientos", 8: "ochocientos", 9: "novecientos"}
LETTERS = {"A": "a", "B": "be", "C": "ce", "D": "de", "E": "e", "F": "efe", "G": "ge", "H": "hache", "I": "i", "J": "jota",
           "K": "ka", "L": "ele", "M": "eme", "N": "ene", "Ñ": "eñe", "O": "o", "P": "pe", "Q": "cu", "R": "erre", "S": "ese",
           "T": "te", "U": "u", "V": "ve", "W": "doble u", "X": "equis", "Y": "ye", "Z": "zeta"}
COMPASS = {"N": "norte", "S": "sur", "E": "este", "W": "oeste"}
ORD_F = {1: "primera", 2: "segunda", 3: "tercera", 4: "cuarta", 5: "quinta", 6: "sexta", 7: "séptima", 8: "octava",
         9: "novena", 10: "décima", 11: "undécima", 12: "duodécima"}
ORD_M = {1: "primero", 2: "segundo", 3: "tercero", 4: "cuarto", 5: "quinto", 6: "sexto", 7: "séptimo", 8: "octavo",
         9: "noveno", 10: "décimo", 11: "undécimo", 12: "duodécimo"}
MONTHS = {"enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "setiembre", "octubre",
          "noviembre", "diciembre"}
# words after a number that are not the thing counted: the number is then said whole ("en 1801 los", "la salida 21 y")
FUNCTION = set("""a al ante bajo con contra de del desde durante e el en entre era eran es esta este fue fueron ha han
hacia hasta hay la las le les lo los más menos mientras muy ni no o para pero por que quien se según sin sobre su sus
también tan tras u un una uno unos unas y ya antes después luego cuando donde como cada aquí ahí allí hoy sí son está
están estaba estaban será serían fuera tiene tienen tenía había habían él ella ellos ellas nosotros este esta estos estas ese esa esos esas aquel aquella
aquellos aquellas otro otra otros otras ambos ambas todos todas varios varias muchos muchas pocos pocas solo sola solos
cuyo cuya cuyos cuyas juntos juntas cerca lejos casi apenas incluso aún aun pues tras mismo misma mismos mismas miles
cientos centenares decenas docenas""".split())
# singular nouns a number may count ("1 milla", "1 pie"); any other counted noun is plural, and a word after a number that
# is neither (a verb: "en 1921 llegó", "la 99 cruza") leaves the number whole
SINGULAR = set("""milla pie acre año persona millón mil dólar vez hora minuto segundo día mes semana siglo grado metro
kilómetro libra tonelada galón barril voltio kilo kilogramo pulgada yarda centavo casa familia misión salida especie hectárea
habitante vehículo carril piso puente árbol edificio hombre mujer niño niña barco avión caballo vaca cabeza tren vagón
estación escuela iglesia aldea isla montaña curva vuelta habitación planta pozo""".split())
# nouns whose gender the ending does not tell
MASC = set("""día días mapa mapas problema problemas programa programas sistema sistemas idioma idiomas clima climas planeta
planetas tema temas poema poemas drama dramas cometa cometas tranvía tranvías sofá sofás atleta atletas turista turistas
artista artistas periodista periodistas ciclista ciclistas astronauta astronautas guía guías pianista pianistas""".split())
# adjectives that can stand between a number and what it counts ("1,760 grandes sombrillas"): the noun after them decides
ADJ = set("""grandes pequeños pequeñas nuevos nuevas viejos viejas antiguos antiguas primeros primeras últimos últimas enormes
buenos buenas malos malas largas largos altos altas hermosos hermosas diminutos diminutas famosos famosas""".split())
FEM = set("""mano manos foto fotos moto motos radio flor flores mujer mujeres vez veces noche noches tarde tardes calle calles
gente clase clases llave llaves nave naves nube nubes parte partes especie especies torre torres fuente fuentes red redes
ley leyes pared paredes imagen imágenes orden piel sal leche nieve muerte suerte serie series hambre carne carnes cárcel
cárceles miel catedral catedrales sede sedes base bases fase fases frase frases llave nación naciones mies cruz cruces
luz luces voz voces paz raíz raíces nariz lombriz perdiz codorniz ave aves""".split())
ROMAN = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100, "D": 500, "M": 1000}
REGNAL = set("""Sargón Sargon Juan Alfonso Carlos Felipe Pío Pio León Benedicto Fernando Enrique Luis Jorge Eduardo Guillermo
Isabel Napoleón Pablo Clemente Gregorio Inocencio Pedro Ricardo Federico Iván Constantino Ramsés Tutmosis Amenhotep""".split())


def _under100(n, g):
    """0-99. g: "m" (before a masculine noun: un, veintiún), "f" (before a feminine one: una, veintiuna), None (said whole)."""
    if n == 1:
        return {"m": "un", "f": "una"}.get(g, "uno")
    if n == 21:
        return {"m": "veintiún", "f": "veintiuna"}.get(g, "veintiuno")
    if n < 30:
        return ONES[n]
    t, u = divmod(n, 10)
    return TENS[t] + (" y " + _under100(u, g) if u else "")


def _under1000(n, g, gh=None):
    """0-999. g: as above, for the last digits; gh: the gender the hundreds agree with (doscientas millas)."""
    if n < 100:
        return _under100(n, g)
    if n == 100:
        return "cien"
    h, r = divmod(n, 100)
    hw = HUNDREDS[h]
    if (gh or g) == "f" and h > 1:
        hw = hw[:-2] + "as"
    return hw + (" " + _under100(r, g) if r else "")


def num_words(n, g=None):
    """A whole number in Mexican Spanish words. g: "m", "f" or None (see _under100)."""
    n = int(n)
    if n < 0:
        return "menos " + num_words(-n, g)
    if n < 1000:
        return _under1000(n, g)
    if n < 1_000_000:
        th, r = divmod(n, 1000)
        # the thousands always take the short "un" / "veintiún" before "mil"; their hundreds agree with the noun
        head = "mil" if th == 1 else _under1000(th, "m", gh=g) + " mil"
        return head + (" " + _under1000(r, g) if r else "")
    if n < 1_000_000_000_000:
        mi, r = divmod(n, 1_000_000)
        head = "un millón" if mi == 1 else num_words(mi, "m") + " millones"
        if not r:
            return head
        return head + " " + num_words(r, g)
    return " ".join(ONES[int(d)] for d in str(n))


def decimal_words(intpart, frac, g=None):
    """4.5 -> cuatro punto cinco; 0.05 -> cero punto cero cinco; 15.75 -> quince punto setenta y cinco."""
    head = num_words(intpart)            # the whole part is said whole: "uno punto cinco millas"
    lead = len(frac) - len(frac.lstrip("0"))
    rest = frac.lstrip("0")
    tail = " ".join(["cero"] * lead + ([num_words(int(rest))] if rest else []))
    return f"{head} punto {tail}"


def _strip(w):
    return "".join(c for c in unicodedata.normalize("NFD", w) if unicodedata.category(c) != "Mn")


def noun_gender(word):
    """"f" or "m" for a counted noun (millas -> f, pies -> m), by a short list and the word's ending."""
    w = word.lower()
    for x in (w, w[:-1] if w.endswith("s") else None, w[:-2] if w.endswith("es") else None):
        if x and x in MASC:
            return "m"
        if x and x in FEM:
            return "f"
    if re.search(r"(ción|ciones|sión|siones|dad|dades|tad|tades|tud|tudes|umbre|umbres|sis)$", w):
        return "f"
    if w in ("millón", "millones", "mil", "billón", "billones"):
        return "m"
    return "f" if re.search(r"(a|as)$", _strip(w)) else "m"


def gender_after(text, end):
    """The gender a number takes from the word after it (text[end:]), or None when it is said whole."""
    m = re.match(r"\s+(?:de\s+)?([a-záéíóúñü]+)(?:\s+([a-záéíóúñü]+))?", text[end:])
    if not m:
        return None
    w = m.group(1)
    if w in ADJ and m.group(2):
        w = m.group(2)
    if re.match(r"\s+de\s", text[end:]):
        # "1 de enero" is a date, "200 de ellos" a part: said whole
        return None
    if w in FUNCTION:
        return None
    if w in SINGULAR or (len(w) > 3 and w.endswith("s")):
        return noun_gender(w)
    return None


def roman_value(s):
    total, prev = 0, 0
    for ch in reversed(s):
        v = ROMAN[ch]
        total = total - v if v < prev else total + v
        prev = max(prev, v)
    return total


def _letters(code):
    return " ".join(LETTERS.get(c, c) for c in code)


def spoken_es(text):
    """The words Estrella is sent for one unit (see the module notes)."""
    s = str(text)
    st = s.strip()
    # a unit that is only an exit letter ("B." / "B") or only a number ("215." / "215"): navigation's phrase bank
    m = re.fullmatch(r"([A-H])([.:]?)", st)
    if m:
        # a lone vowel ("a", "e") comes back from the voice as silence; doubled, it is the letter said a little long
        return {"A": "aa", "E": "ee"}.get(m.group(1), LETTERS[m.group(1)]) + m.group(2)
    m = re.fullmatch(r"(\d{1,3})(\.?)", st)
    if m:
        return num_words(m.group(1)) + m.group(2)
    # the app's own name
    s = re.sub(r"\bI-5 Buddy\b", "I cinco Buddy", s)
    # a U-turn: the letter quoted, or the voice tends to add a syllable after a lone "u" at the end (2026-11-21 probes)
    s = re.sub(r"\b([Vv]uelta en) U\b", "\\1 \u201cu\u201d", s)
    # abbreviations of English names
    s = re.sub(r"\bSt\. (?=[A-Z])", "Saint ", s)
    s = re.sub(r"\bMt\. ", "Mount ", s)
    s = re.sub(r"\bFt\. ", "Fort ", s)
    s = re.sub(r"\bJr\.", "Junior", s)
    s = re.sub(r"(?<=[A-Za-z]) Sr\.(?=,|\s|$)", " Senior", s)
    s = re.sub(r"\bDr\. (?=[A-Z])", "doctor ", s)
    s = re.sub(r"\bBros\.(?=\s+[a-záéíóúñ])", "Brothers", s)
    s = re.sub(r"\bBros\b\.?", "Brothers", s)
    s = re.sub(r"\bNo\. (?=\d)", "número ", s)
    s = re.sub(r"\bn\.º\s*(?=\d)", "número ", s)
    s = re.sub(r"\bD\.C\.", "de ce", s)
    s = re.sub(r"\b([A-Z]{1,3})&([A-Z]{1,3})\b", lambda m: _letters(m.group(1)) + " y " + _letters(m.group(2)), s)
    s = s.replace("&", " y ")
    s = re.sub(r"(?<=\w)/(?=\w)", " ", s)
    s = re.sub(r"\b9-1-1\b", "nueve uno uno", s)
    s = re.sub(r"\b(\d+)\+", lambda m: num_words(m.group(1)) + " o más", s)
    s = re.sub(r"\bEF(\d)\b", lambda m: "e efe " + num_words(m.group(1)), s)
    s = re.sub(r"\b(\d)D\b", lambda m: num_words(m.group(1)) + " de", s)          # 3D
    s = re.sub(r"\b([A-Z]{1,2})(\d{1,3})\b", lambda m: _letters(m.group(1)) + " " + num_words(m.group(2)), s)   # V8, A113
    # ordinals: 1.ª (the roundabouts), 11.ª División; 1.º / 1.er
    s = re.sub(r"\b(\d{1,2})\.ª", lambda m: ORD_F.get(int(m.group(1)), num_words(m.group(1))), s)
    s = re.sub(r"\b(\d{1,2})\.(?:º|er)", lambda m: ORD_M.get(int(m.group(1)), num_words(m.group(1))), s)
    # Roman numerals: centuries (siglo XIX) as numbers, rulers (Sargón II, Juan XXIII) as ordinals up to ten
    s = re.sub(r"\b(siglos?) ([MDCLXVI]+)\b", lambda m: m.group(1) + " " + num_words(roman_value(m.group(2))), s)
    s = re.sub(r"\b(\w+) ([XVI]{1,6})\b(?!-)", lambda m: (m.group(1) + " " + (ORD_M.get(roman_value(m.group(2))) if roman_value(m.group(2)) <= 10 else num_words(roman_value(m.group(2)))))
               if m.group(1) in REGNAL and re.fullmatch(r"X{0,3}(IX|IV|V?I{0,3})", m.group(2)) else m.group(0), s)
    # routes: la I-5, I-5W, la Interestatal 5; la U.S. 101, US 99, U.S. Highway 99W; la Highway 99; Route 99
    def interstate(m):
        return "interestatal " + num_words(m.group(1)) + (" " + COMPASS[m.group(2)] if m.group(2) else "")
    s = re.sub(r"\bI-(\d{1,3})([NSEW])?\b", interstate, s)
    s = re.sub(r"\b(?:U\.S\.|US)(?=[ -](?:Highway |Route )?\d)[ -]", "u ese ", s)
    s = re.sub(r"\bU\.S\.", "u ese", s)
    s = re.sub(r"\b(Highway|Route|Interestatal|interestatal|Ruta|ruta|carretera) (\d{1,3})([NSEW])?\b",
               lambda m: m.group(1) + " " + num_words(m.group(2)) + (" " + COMPASS[m.group(3)] if m.group(3) else ""), s)
    s = re.sub(r"\bu ese (\d{1,3})([NSEW])?\b", lambda m: "u ese " + num_words(m.group(1)) + (" " + COMPASS[m.group(2)] if m.group(2) else ""), s)
    # codes like OR-7, B-24, DC-3, P-22, SR-71, F-117 (letters by name, then the number)
    s = re.sub(r"\b([A-Z]{1,3})-(\d{1,4})\b", lambda m: _letters(m.group(1)) + " " + num_words(m.group(2)), s)
    # times: 4:52 de la mañana -> cuatro cincuenta y dos; 5:05 -> cinco y cinco; la 1:15 -> la una quince
    def clock(m):
        h, mi = int(m.group(1)), int(m.group(2))
        hw = "una" if h == 1 else num_words(h)
        if mi == 0:
            return hw
        return hw + (" y " if mi < 10 else " ") + num_words(mi)
    s = re.sub(r"\b(\d{1,2}):(\d{2})\b", clock, s)
    # money: $3.5 millones -> tres punto cinco millones de dólares; $1 millón -> un millón de dólares; $150 -> ciento cincuenta dólares
    def money(m):
        whole, frac, big = m.group(1).replace(",", ""), m.group(2), m.group(3)
        if big:
            amount = decimal_words(whole, frac) if frac else num_words(whole, "m")
            return f"{amount} {big} de dólares"
        if frac:
            cents = int(frac.ljust(2, "0")[:2])
            return f"{num_words(whole, 'm')} {'dólar' if whole == '1' else 'dólares'}" + (f" con {num_words(cents, 'm')} centavos" if cents else "")
        return f"{num_words(whole, 'm')} {'dólar' if whole == '1' else 'dólares'}"
    s = re.sub(r"\$(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(?:\s+(mil millones|millones|millón))?", money, s)
    s = re.sub(r"(\d)\s?%", r"\1 por ciento", s)
    # dates: el 1 de mayo -> el primero de mayo
    s = re.sub(r"\b1 de (?=(" + "|".join(MONTHS) + r")\b)", "primero de ", s)
    # every other number, with the gender of what it counts
    def number(m):
        whole, frac = m.group(1).replace(",", ""), m.group(2)
        if frac:
            return decimal_words(whole, frac)
        return num_words(whole, gender_after(s, m.end()))
    s = re.sub(r"(?<![\w.,])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(?![\d\w])", number, s)
    return re.sub(r"\s{2,}", " ", s)


CHECKS = [
    ("En 2 millas, tome la salida 215 hacia la I-5.", "En dos millas, tome la salida doscientos quince hacia la interestatal cinco."),
    ("En 1 milla,", "En una milla,"),
    ("En 1,000 pies,", "En mil pies,"),
    ("En 500 pies,", "En quinientos pies,"),
    ("En aproximadamente 21 millas, a su izquierda:", "En aproximadamente veintiuna millas, a su izquierda:"),
    ("En aproximadamente 25 millas,", "En aproximadamente veinticinco millas,"),
    ("215.", "doscientos quince."), ("21", "veintiuno"), ("1.", "uno."), ("B.", "be."), ("H", "hache"), ("A.", "aa."), ("E", "ee"), ("A:", "aa:"), ("B:", "be:"), ("En 500 pies, dé vuelta en U.", "En quinientos pies, dé vuelta en \u201cu\u201d."),
    ("la U.S. 101.", "la u ese ciento uno."), ("la Highway 99.", "la Highway noventa y nueve."), ("la I-405.", "la interestatal cuatrocientos cinco."),
    ("En la glorieta, tome la 2.ª salida.", "En la glorieta, tome la segunda salida."),
    ("la I-5 alcanza 4,144 pies", "la interestatal cinco alcanza cuatro mil ciento cuarenta y cuatro pies"),
    ("se encontró en 1806 en otro cañón, a unas 15 millas al noreste.", "se encontró en mil ochocientos seis en otro cañón, a unas quince millas al noreste."),
    ("unas 200 personas", "unas doscientas personas"), ("unos 200 pies", "unos doscientos pies"), ("1 pie", "un pie"),
    ("21 años", "veintiún años"), ("31 acres", "treinta y un acres"), ("100 años", "cien años"), ("101 millas", "ciento una millas"),
    ("en 1801 los", "en mil ochocientos uno los"), ("el 1 de mayo de 2017", "el primero de mayo de dos mil diecisiete"),
    ("el 21 de julio de 1952", "el veintiuno de julio de mil novecientos cincuenta y dos"),
    ("300,000 acres", "trescientos mil acres"), ("21,000 personas", "veintiún mil personas"), ("200,000 toneladas", "doscientas mil toneladas"),
    ("4.5 millas", "cuatro punto cinco millas"), ("0.7 millas", "cero punto siete millas"), ("15.75", "quince punto setenta y cinco"),
    ("A las 4:52 de la mañana", "A las cuatro cincuenta y dos de la mañana"), ("a las 11:30", "a las once treinta"),
    ("$3.5 millones", "tres punto cinco millones de dólares"), ("$741 millones", "setecientos cuarenta y un millones de dólares"),
    ("$1 millón", "un millón de dólares"), ("$10,000 a Charles", "diez mil dólares a Charles"), ("$150 el acre", "ciento cincuenta dólares el acre"),
    ("$1,000 millones", "mil millones de dólares"),
    ("siglo XIX", "siglo diecinueve"), ("siglo XX.", "siglo veinte."), ("Sargón II,", "Sargón segundo,"), ("Juan XXIII", "Juan veintitrés"),
    ("Alfonso XIII de España", "Alfonso trece de España"), ("Pacific DC Intertie", "Pacific DC Intertie"),
    ("I-505, antes I-5W.", "interestatal quinientos cinco, antes interestatal cinco oeste."), ("la I-35E", "la interestatal treinta y cinco este"),
    ("la antigua U.S. Highway 99W", "la antigua u ese Highway noventa y nueve oeste"), ("la US 99", "la u ese noventa y nueve"),
    ("OR-7", "o erre siete"), ("B-24 Liberator", "be veinticuatro Liberator"), ("SR-71 Blackbird", "ese erre setenta y uno Blackbird"),
    ("la red de PG&E.", "la red de pe ge y e."), ("A&W Root Beer", "a y doble u Root Beer"), ("Washington, D.C., y", "Washington, de ce, y"),
    ("la presa St. Francis.", "la presa Saint Francis."), ("Richard Henry Dana Jr., quien", "Richard Henry Dana Junior, quien"),
    ("Warner Bros. y la Walt", "Warner Brothers y la Walt"), ("el Dr. James Fulton", "el doctor James Fulton"),
    ("Copco No. 2 fue", "Copco número dos fue"), ("n.º 148.", "número ciento cuarenta y ocho."), ("la 11.ª División", "la undécima División"),
    ("emergencia 9-1-1.", "emergencia nueve uno uno."), ("letrero con 4+ salidas.", "letrero con cuatro o más salidas."),
    ("un tornado EF3,", "un tornado e efe tres,"), ("escaneo en 3D,", "escaneo en tres de,"), ("para I-5 Buddy.", "para I cinco Buddy."),
    ("Interestatal 5", "Interestatal cinco"), ("Frost/Nixon", "Frost Nixon"), ("En 1,926 pies", "En mil novecientos veintiséis pies"),
    ("unos 1,500,000 acres", "unos un millón quinientos mil acres"), ("2,200 acres", "dos mil doscientos acres"),
    ("un V8 de 260 pulgadas", "un ve ocho de doscientas sesenta pulgadas"), ("el código A113 como", "el código a ciento trece como"),
    ("En 1921 llegó", "En mil novecientos veintiuno llegó"), ("en 1820 cruza", "en mil ochocientos veinte cruza"),
    ("unas 21 misiones", "unas veintiuna misiones"), ("en 1850 ella", "en mil ochocientos cincuenta ella"),
    ("a 1 milla", "a una milla"), ("unos 201 años", "unos doscientos un años"),
    ("colocaron 1,760 grandes sombrillas", "colocaron mil setecientas sesenta grandes sombrillas"),
    ("1,468 bautizos y 797 muertes.", "mil cuatrocientos sesenta y ocho bautizos y setecientas noventa y siete muertes."),
    ("en 1921 miles de", "en mil novecientos veintiuno miles de"), ("con 41 atletas.", "con cuarenta y un atletas."),
    ("más de 300 aves", "más de trescientas aves"),
]


if __name__ == "__main__":
    if "--test" in sys.argv:
        bad = 0
        for a, want in CHECKS:
            got = spoken_es(a)
            if got != want:
                bad += 1
                print(f"FAIL {a!r}\n   got  {got!r}\n   want {want!r}")
        print(f"{len(CHECKS) - bad}/{len(CHECKS)} pass")
        sys.exit(1 if bad else 0)
    for a in sys.argv[1:]:
        print(spoken_es(a))
