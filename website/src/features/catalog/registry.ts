import type { RegistryEntry } from "./types";

/** Curated metadata, reviewed against primary source documentation on this date. */
export const catalogCheckedAt = "2026-11-07";
export const registry = [
  {
    id: "cbs-buurten",
    title: "Wonen en buurtcijfers",
    summary:
      "25 kenmerken over woningen, WOZ, inkomen, opleiding, energie en voorzieningen, gekoppeld aan buurtvlakken.",
    theme: "wonen",
    publisher: "CBS / PDOK",
    coverage: "amsterdam",
    level: "Buurt",
    time: "CBS 2023–2025; indicatorjaar verschilt",
    formats: ["GeoJSON", "CSV"],
    availability: "local",
    source: {
      label: "CBS / PDOK",
      url: "https://opendata.cbs.nl/CBS/nl/dataset/86165NED/table",
    },
    access:
      "Bestanden uit onze vastgelegde CBS/PDOK-momentopname; bronmetadata en bronjaren worden meegeleverd.",
    caveat:
      "Buurtgemiddelden zijn geen individuele woningwaarden. WOZ-waardepeildatum 2024; ontbrekende cijfers blijven onbekend.",
    tags: [
      "woningwaarde",
      "belasting",
      "nieuwbouw",
      "koop",
      "huur",
      "opleiding",
      "huisarts",
      "supermarkt",
      "WOZ",
    ],
    usedIn: [
      {
        label: "Open woningkaart",
        href: "/analysis/housing/",
      },
    ],
    localKey: "housing",
  },
  {
    id: "nwb-wegen",
    title: "Amsterdamse wegen en straten",
    summary:
      "Originele NWB-wegvakken voor geografische koppelingen en onderzoek naar straten.",
    theme: "mobiliteit",
    publisher: "Rijkswaterstaat / PDOK",
    coverage: "amsterdam",
    level: "Wegvak",
    time: "Snapshot 2026",
    formats: ["GeoJSON"],
    availability: "local",
    source: {
      label: "Rijkswaterstaat / PDOK",
      url: "https://api.pdok.nl/rws/nationaal-wegenbestand-wegen/ogc/v1",
    },
    access:
      "Lokale snapshot van officiële brongeometrie; originele wegvak-ID’s blijven behouden.",
    caveat:
      "Parallelle rijbanen tellen apart. Het wegenbestand is geen volledig routeringsnetwerk.",
    tags: ["weg", "fiets", "NWB", "straat", "verkeer"],
    usedIn: [
      {
        label: "Open straatmonitor",
        href: "/analysis/streets/",
      },
    ],
    localKey: "roads",
  },
  {
    id: "straatregistraties",
    title: "Bomen, licht en meldingen per wegvak",
    summary:
      "Gemeentelijke registraties gekoppeld aan wegen, met maandtotalen voor meldingen.",
    theme: "groen",
    publisher: "Gemeente Amsterdam",
    coverage: "amsterdam",
    level: "Wegvak",
    time: "Bronstand 2026; 12 complete meldingsmaanden",
    formats: ["JSON"],
    availability: "local",
    source: {
      label: "Gemeente Amsterdam",
      url: "https://api.data.amsterdam.nl/v1/docs/datasets/meldingen.html",
    },
    access:
      "Dit bestand met afgeleide tellingen is lokaal beschikbaar; bronnen en koppelmethode staan in de metadata.",
    caveat:
      "Afgeleide koppelingen, geen losse meldingslocaties of veiligheidsscore. Lege registratie is geen bewezen afwezigheid.",
    tags: [
      "boom",
      "groen",
      "licht",
      "storingen",
      "overlast",
      "MORA",
      "onderhoud",
    ],
    usedIn: [
      {
        label: "Open straatmonitor",
        href: "/analysis/streets/",
      },
    ],
    localKey: "observations",
  },
  {
    id: "straatconcentraties",
    title: "Bronvakken voor groen en meldingen",
    summary:
      "Geaggregeerde bronvakken achter de concentratiekaarten van de straatmonitor.",
    theme: "groen",
    publisher: "Gemeente Amsterdam",
    coverage: "amsterdam",
    level: "Bronvak van 25 meter",
    time: "Bronstand 2026",
    formats: ["JSON"],
    availability: "local",
    source: {
      label: "Gemeente Amsterdam",
      url: "https://api.data.amsterdam.nl/v1/docs/index.html",
    },
    access:
      "Downloadbaar geaggregeerd bronbestand; veldbetekenis en herkomst staan naast de download.",
    caveat:
      "Dit interne rasterbestand bevat aantallen per bronvak, geen afzonderlijke incidenten. Gebruik de straatmonitor voor kaartweergave.",
    tags: ["heatmap", "concentratie", "bomen", "licht", "meldingen"],
    usedIn: [
      {
        label: "Open straatmonitor",
        href: "/analysis/streets/",
      },
    ],
    localKey: "heat",
  },
  {
    id: "bag-adressen",
    title: "BAG-adressen en gebouwen",
    summary:
      "Woonverblijfsobjecten, panden, gebruiksoppervlakte en bouwjaar voor adresonderzoek.",
    theme: "wonen",
    publisher: "Kadaster / PDOK",
    coverage: "netherlands",
    level: "Adres / pand",
    time: "Actuele registratie bij opvraag",
    formats: ["JSON", "GeoJSON"],
    availability: "connected",
    source: {
      label: "Kadaster / PDOK",
      url: "https://www.kadaster.nl/zakelijk/producten/adressen-en-gebouwen/bag-ogc-api-s",
    },
    access:
      "De woningkaart haalt de BAG per gekozen buurt op en biedt daarna een export.",
    caveat:
      "Een pand kan meerdere woningen bevatten. Woningen tellen we op uniek verblijfsobject-ID; er zijn geen bewoners of verkoopprijzen.",
    tags: ["BAG", "bouwjaar", "woning", "oppervlakte", "huisnummer"],
    usedIn: [
      {
        label: "Open woningkaart",
        href: "/analysis/housing/",
      },
    ],
  },
  {
    id: "bomen",
    title: "Gemeentelijke bomen",
    summary:
      "Boomlocaties en beheerkenmerken voor groen in de omgeving van een woning.",
    theme: "groen",
    publisher: "Gemeente Amsterdam",
    coverage: "amsterdam",
    level: "Boom",
    time: "Registratie bij opvraag",
    formats: ["JSON", "GeoJSON", "CSV"],
    availability: "connected",
    source: {
      label: "Gemeente Amsterdam",
      url: "https://api.data.amsterdam.nl/v1/docs/datasets/bomen.html",
    },
    access:
      "Amsterdam-API’s kunnen een sleutel en aanvullende tabelrechten vereisen. Controleer de toegang bij de bron.",
    caveat:
      "Gemeentelijke bomen zijn geen volledige boomkroonkaart; particuliere bomen ontbreken.",
    tags: ["groen", "boomsoort", "schaduw", "bomen"],
    usedIn: [
      {
        label: "Open woningkaart",
        href: "/analysis/housing/",
      },
    ],
  },
  {
    id: "energielabels",
    title: "Energielabels bij een woning",
    summary:
      "Geregistreerde labels, registratiedatum en geldigheid gekoppeld aan het BAG-object.",
    theme: "energie",
    publisher: "Gemeente Amsterdam",
    coverage: "amsterdam",
    level: "Verblijfsobject",
    time: "Registratie en geldigheidsdatum per label",
    formats: ["JSON", "CSV"],
    availability: "connected",
    source: {
      label: "Gemeente Amsterdam",
      url: "https://api.data.amsterdam.nl/v1/docs/datasets/duurzaamheid.html",
    },
    access:
      "Amsterdam-API’s kunnen een sleutel en aanvullende tabelrechten vereisen. Controleer de toegang bij de bron.",
    caveat:
      "Ontbrekend betekent niet onzuinig; een verlopen label wordt niet als actueel gepresenteerd.",
    tags: ["isolatie", "energielabel", "verduurzamen"],
    usedIn: [
      {
        label: "Open woningkaart",
        href: "/analysis/housing/",
      },
    ],
  },
  {
    id: "geluid",
    title: "Gemodelleerd omgevingsgeluid",
    summary:
      "Geluidscontext op een locatie uit een vastgelegde RIVM-kaartlaag.",
    theme: "klimaat",
    publisher: "RIVM / Atlas Leefomgeving",
    coverage: "netherlands",
    level: "Raster",
    time: "Kaart 2022; samengestelde bronjaren 2022–2025",
    formats: ["WMS", "JSON"],
    availability: "connected",
    source: {
      label: "RIVM / Atlas Leefomgeving",
      url: "https://www.atlasleefomgeving.nl/veelgestelde-vragen",
    },
    access:
      "Raadpleeg de bron voor de beschikbare downloads, licentie en eventuele toegangsvoorwaarden.",
    caveat:
      "Een rasterwaarde is geen gevelmeting, actuele hinder of wettelijke toets.",
    tags: ["lawaai", "geluidsoverlast", "decibel", "Lden"],
    usedIn: [
      {
        label: "Open woningkaart",
        href: "/analysis/housing/",
      },
    ],
  },
  {
    id: "erfpacht",
    title: "Erfpachtuitgevers per perceel",
    summary:
      "Ruimtelijke indicatie van de erfpachtuitgever rondom een gekozen adres.",
    theme: "wonen",
    publisher: "Gemeente Amsterdam",
    coverage: "amsterdam",
    level: "Perceel",
    time: "Registratie bij opvraag",
    formats: ["JSON", "GeoJSON"],
    availability: "connected",
    source: {
      label: "Gemeente Amsterdam",
      url: "https://api.data.amsterdam.nl/v1/docs/datasets/benkagg.html#brkkaartlaagerfpachtuitgevers",
    },
    access:
      "Amsterdam-API’s kunnen een sleutel en aanvullende tabelrechten vereisen. Controleer de toegang bij de bron.",
    caveat:
      "Een kaartmatch bewijst geen appartementsrecht, canon, afkoop of tijdvak. Geen match betekent onbekend.",
    tags: ["grond", "canon", "afkoop", "eigendom"],
    usedIn: [
      {
        label: "Open woningkaart",
        href: "/analysis/housing/",
      },
    ],
  },
  {
    id: "bnb-wijken",
    title: "B&B-beschikbaarheid per wijk",
    summary:
      "Officiële beschikbaarheidscategorie voor vergunningswijken bij een woninglocatie.",
    theme: "wonen",
    publisher: "Gemeente Amsterdam",
    coverage: "amsterdam",
    level: "Vergunningswijk",
    time: "Bronstatus bij opvraag",
    formats: ["JSON", "GeoJSON"],
    availability: "connected",
    source: {
      label: "Gemeente Amsterdam",
      url: "https://api.data.amsterdam.nl/v1/docs/datasets/vergunningen.html#bedandbreakfast",
    },
    access:
      "Amsterdam-API’s kunnen een sleutel en aanvullende tabelrechten vereisen. Controleer de toegang bij de bron.",
    caveat:
      "Wijkbeschikbaarheid bewijst geen vergunning of verhuuractiviteit op een afzonderlijk adres. Het aparte B&B-voorbeeld gebruikt fictieve aantallen.",
    tags: ["vakantieverhuur", "toerisme", "vergunning"],
    usedIn: [
      {
        label: "Open woningkaart",
        href: "/analysis/housing/",
      },
    ],
  },
  {
    id: "openbare-verlichting",
    title: "Lichtobjecten en storingsstatus",
    summary:
      "Geregistreerde lichtobjecten en storingen voor verkenning van de openbare ruimte.",
    theme: "groen",
    publisher: "Gemeente Amsterdam",
    coverage: "amsterdam",
    level: "Lichtobject",
    time: "Bronstand bij de aanbieder",
    formats: ["JSON", "GeoJSON", "CSV"],
    availability: "connected",
    source: {
      label: "Gemeente Amsterdam",
      url: "https://api.data.amsterdam.nl/v1/docs/datasets/storingsmeldingen_ovl_en_klokken.html",
    },
    access:
      "Amsterdam-API’s kunnen een sleutel en aanvullende tabelrechten vereisen. Controleer de toegang bij de bron.",
    caveat:
      "Objectdichtheid is geen lichtsterkte of veiligheidsmeting; objecttypen verschillen.",
    tags: ["lamp", "verlichting", "storing", "lantaarn"],
    usedIn: [
      {
        label: "Open straatmonitor",
        href: "/analysis/streets/",
      },
    ],
  },
  {
    id: "mora",
    title: "Meldingen openbare ruimte",
    summary:
      "Meldingscategorieën, tijdstippen en openbare visualisatielocaties voor onderzoek naar de buitenruimte.",
    theme: "groen",
    publisher: "Gemeente Amsterdam",
    coverage: "amsterdam",
    level: "Melding",
    time: "Bronstand bij de aanbieder",
    formats: ["JSON", "GeoJSON", "CSV"],
    availability: "connected",
    source: {
      label: "Gemeente Amsterdam",
      url: "https://api.data.amsterdam.nl/v1/docs/datasets/meldingen.html",
    },
    access:
      "Amsterdam-API’s kunnen een sleutel en aanvullende tabelrechten vereisen. Controleer de toegang bij de bron.",
    caveat:
      "Registratie en meldingsbereidheid beïnvloeden aantallen. Niet alle velden en categorieën zijn openbaar.",
    tags: ["afval", "overlast", "onderhoud", "MORA"],
    usedIn: [
      {
        label: "Open straatmonitor",
        href: "/analysis/streets/",
      },
    ],
  },
  {
    id: "afvalcontainers",
    title: "Afvalcontainers en inzameling",
    summary:
      "Containerlocaties en afvalfracties voor het vinden van inzamelvoorzieningen.",
    theme: "groen",
    publisher: "Gemeente Amsterdam",
    coverage: "amsterdam",
    level: "Container / locatie",
    time: "Bronstand bij de aanbieder",
    formats: ["JSON", "GeoJSON", "CSV"],
    availability: "source",
    source: {
      label: "Gemeente Amsterdam",
      url: "https://api.data.amsterdam.nl/v1/docs/datasets/huishoudelijkafval.html",
    },
    access:
      "Amsterdam-API’s kunnen een sleutel en aanvullende tabelrechten vereisen. Controleer de toegang bij de bron.",
    caveat:
      "Kies de relevante openbare tabel; locaties zeggen niets over de actuele vulgraad.",
    tags: ["glas", "papier", "textiel", "afval", "recycling"],
  },
  {
    id: "sport",
    title: "Sportlocaties en speelplekken",
    summary:
      "Locaties van sportvoorzieningen, parken en speelplekken in de stad.",
    theme: "mensen",
    publisher: "Gemeente Amsterdam",
    coverage: "amsterdam",
    level: "Voorziening",
    time: "Bronstand bij de aanbieder",
    formats: ["JSON", "GeoJSON", "CSV"],
    availability: "source",
    source: {
      label: "Gemeente Amsterdam",
      url: "https://api.data.amsterdam.nl/v1/docs/datasets/sport.html",
    },
    access:
      "Amsterdam-API’s kunnen een sleutel en aanvullende tabelrechten vereisen. Controleer de toegang bij de bron.",
    caveat:
      "De tabel en registratie bepalen welke voorzieningen zijn opgenomen; controleer beheerstatus en toegang.",
    tags: ["kinderen", "speeltuin", "speeltoestel", "park", "sporthal"],
  },
  {
    id: "monumenten",
    title: "Monumenten en erfgoed",
    summary:
      "Registraties van gemeentelijke monumenten, rijksmonumenten en erfgoedlocaties.",
    theme: "wonen",
    publisher: "Gemeente Amsterdam",
    coverage: "amsterdam",
    level: "Object / gebied",
    time: "Bronstand bij de aanbieder",
    formats: ["JSON", "GeoJSON", "CSV"],
    availability: "source",
    source: {
      label: "Gemeente Amsterdam",
      url: "https://api.data.amsterdam.nl/v1/docs/datasets/monumenten.html",
    },
    access:
      "Amsterdam-API’s kunnen een sleutel en aanvullende tabelrechten vereisen. Controleer de toegang bij de bron.",
    caveat:
      "Gebruik de bron voor de actuele beschermingsstatus; een kaartregistratie vervangt geen juridische toets.",
    tags: ["erfgoed", "historisch", "UNESCO", "beschermd"],
  },
  {
    id: "beheerobjecten",
    title: "Beheerobjecten openbare ruimte",
    summary:
      "Groenobjecten, verhardingen, afvalbakken en waterobjecten voor een gedetailleerd straatbeeld.",
    theme: "groen",
    publisher: "Gemeente Amsterdam",
    coverage: "amsterdam",
    level: "Beheerobject",
    time: "Bronstand bij de aanbieder",
    formats: ["JSON", "GeoJSON", "CSV"],
    availability: "source",
    source: {
      label: "Gemeente Amsterdam",
      url: "https://api.data.amsterdam.nl/v1/docs/datasets/objectenopenbareruimte.html",
    },
    access:
      "Amsterdam-API’s kunnen een sleutel en aanvullende tabelrechten vereisen. Controleer de toegang bij de bron.",
    caveat:
      "Beschikbaarheid en rechten verschillen per tabel; beheerregistraties zijn geen volledige kwaliteitsinspectie.",
    tags: ["stoep", "afvalbak", "water", "hekken", "groen"],
  },
  {
    id: "aardgasvrij",
    title: "Aardgasvrije buurten en initiatieven",
    summary:
      "Gebieden en initiatieven rond de overstap naar aardgasvrije buurten.",
    theme: "energie",
    publisher: "Gemeente Amsterdam",
    coverage: "amsterdam",
    level: "Buurt / initiatief",
    time: "Planning en status bij de aanbieder",
    formats: ["JSON", "GeoJSON"],
    availability: "source",
    source: {
      label: "Gemeente Amsterdam",
      url: "https://api.data.amsterdam.nl/v1/docs/datasets/aardgasvrijezones.html",
    },
    access:
      "Amsterdam-API’s kunnen een sleutel en aanvullende tabelrechten vereisen. Controleer de toegang bij de bron.",
    caveat:
      "Een gepland gebied betekent niet dat iedere woning al aardgasvrij is.",
    tags: ["warmte", "duurzaamheid", "gasvrij", "energietransitie"],
  },
  {
    id: "bbga",
    title: "Basisbestand Gebieden Amsterdam",
    summary:
      "Aanvullende gebiedscijfers voor het onderzoeken van Amsterdamse buurten en wijken.",
    theme: "mensen",
    publisher: "Onderzoek en Statistiek Amsterdam",
    coverage: "amsterdam",
    level: "Buurt / wijk / gebied",
    time: "Per indicator en verslagjaar",
    formats: ["JSON", "Tabellen"],
    availability: "source",
    source: {
      label: "Onderzoek en Statistiek Amsterdam",
      url: "https://api.data.amsterdam.nl/v1/docs/datasets/bbga.html",
    },
    access:
      "Raadpleeg de bron voor de beschikbare downloads, licentie en eventuele toegangsvoorwaarden.",
    caveat:
      "Definities, grenzen en jaren verschillen per indicator; koppel op officiële gebiedscodes.",
    tags: ["inwoners", "sociaal", "demografie", "BBGA"],
  },
  {
    id: "cbs-voorzieningen",
    title: "Nabijheid van voorzieningen",
    summary:
      "Afstanden en bereik van voorzieningen om buurtprofielen verder te verdiepen.",
    theme: "mensen",
    publisher: "CBS",
    coverage: "netherlands",
    level: "Buurt / wijk / raster",
    time: "Per verslagjaar",
    formats: ["CSV", "Excel", "Kaartbestanden"],
    availability: "source",
    source: {
      label: "CBS",
      url: "https://www.cbs.nl/nl-nl/dossier/nederland-regionaal/ruimtelijke-statistieken/nabijheid",
    },
    access:
      "Raadpleeg de bron voor de beschikbare downloads, licentie en eventuele toegangsvoorwaarden.",
    caveat:
      "CBS-afstanden over de weg zijn geen afstand vanaf ieder afzonderlijk huis. Definities kunnen tussen jaren wijzigen.",
    tags: [
      "huisarts",
      "school",
      "supermarkt",
      "bibliotheek",
      "afstand",
      "kinderdagverblijf",
    ],
  },
  {
    id: "cbs-tijdreeksen",
    title: "Vergelijkbare wijk- en buurtcijfers",
    summary:
      "Tijdreeksen over bevolking, inkomen en woningen met een geharmoniseerde gebiedsindeling.",
    theme: "mensen",
    publisher: "CBS",
    coverage: "netherlands",
    level: "Buurt / wijk",
    time: "Reeks en indeling volgens de bron",
    formats: ["CSV", "Excel", "Tabellen"],
    availability: "source",
    source: {
      label: "CBS",
      url: "https://www.cbs.nl/nl-nl/dossier/nederland-regionaal/wijk-en-buurtstatistieken",
    },
    access:
      "Raadpleeg de bron voor de beschikbare downloads, licentie en eventuele toegangsvoorwaarden.",
    caveat:
      "Een geharmoniseerde tijdreeks gebruikt een vaste gebiedsindeling; meng die niet ongemerkt met oorspronkelijke jaargrenzen.",
    tags: ["bevolking", "inkomen", "trend", "woningmarkt", "historie"],
  },
  {
    id: "duo-scholen",
    title: "Schoollocaties en onderwijs",
    summary:
      "Adressen en onderwijsgegevens voor het vinden en vergelijken van onderwijsvoorzieningen.",
    theme: "mensen",
    publisher: "DUO",
    coverage: "netherlands",
    level: "Vestiging / instelling",
    time: "Per publicatie",
    formats: ["CSV", "Excel"],
    availability: "source",
    source: {
      label: "DUO",
      url: "https://www.duo.nl/open_onderwijsdata/",
    },
    access:
      "Raadpleeg de bron voor de beschikbare downloads, licentie en eventuele toegangsvoorwaarden.",
    caveat:
      "Vestiging, bestuur en instelling zijn verschillende eenheden. Controleer peildatum en definities.",
    tags: ["basisschool", "onderwijs", "scholen", "leerlingen", "BRIN"],
  },
  {
    id: "luchtmeetnet",
    title: "Luchtkwaliteit bij meetstations",
    summary:
      "Metingen van onder meer fijnstof en stikstofdioxide, met locaties van meetstations.",
    theme: "klimaat",
    publisher: "Luchtmeetnet / RIVM",
    coverage: "netherlands",
    level: "Meetstation / uurmeting",
    time: "Uurmetingen; jaarbestanden voor historie",
    formats: ["JSON", "Jaarbestanden"],
    availability: "source",
    source: {
      label: "Luchtmeetnet / RIVM",
      url: "https://api-docs.luchtmeetnet.nl/",
    },
    access:
      "Raadpleeg de bron voor de beschikbare downloads, licentie en eventuele toegangsvoorwaarden.",
    caveat:
      "Een stationsmeting geldt niet voor ieder adres. Recente waarden kunnen voorlopig zijn; de API hanteert fair use.",
    tags: ["lucht", "fijnstof", "NO2", "PM10", "PM25", "stikstof"],
  },
  {
    id: "klimaateffectatlas",
    title: "Hitte, droogte en wateroverlast",
    summary:
      "Kaarten en scenario’s om klimaateffecten en kwetsbaarheden in gebieden te verkennen.",
    theme: "klimaat",
    publisher: "Stichting CAS / Klimaateffectatlas",
    coverage: "netherlands",
    level: "Raster / buurt / scenario",
    time: "Per kaart en scenario",
    formats: ["GeoTIFF", "GeoPackage", "Kaartviewer"],
    availability: "source",
    source: {
      label: "Stichting CAS / Klimaateffectatlas",
      url: "https://www.klimaateffectatlas.nl/nl/faq",
    },
    access:
      "Raadpleeg de bron voor de beschikbare downloads, licentie en eventuele toegangsvoorwaarden.",
    caveat:
      "Een scenario is geen voorspelling van schade aan een individuele woning. Resolutie en modeljaar verschillen per kaart.",
    tags: ["hitte", "klimaat", "overstroming", "regen", "droogte", "water"],
  },
  {
    id: "ahn",
    title: "Terreinhoogte en oppervlakken",
    summary:
      "Hoogtemodellen en puntenwolken voor onderzoek naar hoogteverschillen.",
    theme: "basis",
    publisher: "AHN / PDOK",
    coverage: "netherlands",
    level: "Raster / puntenwolk",
    time: "Verschilt per opnamegebied",
    formats: ["Raster", "Puntenwolk", "Webservice"],
    availability: "source",
    source: {
      label: "AHN / PDOK",
      url: "https://www.ahn.nl/open-data",
    },
    access:
      "Raadpleeg de bron voor de beschikbare downloads, licentie en eventuele toegangsvoorwaarden.",
    caveat:
      "Controleer opnamejaar en het verschil tussen maaiveld en objecthoogte. Hoogte alleen bewijst geen wateroverlastrisico.",
    tags: ["hoogte", "reliëf", "schaduw", "water", "AHN"],
  },
  {
    id: "bgt",
    title: "Gedetailleerde topografie",
    summary:
      "Gebouwen, wegen, water en terreindelen als basis voor precieze ruimtelijke analyses.",
    theme: "basis",
    publisher: "Kadaster / PDOK",
    coverage: "netherlands",
    level: "Topografisch object",
    time: "Bronstand bij de aanbieder",
    formats: ["OGC API", "GeoJSON", "Kaartlagen"],
    availability: "source",
    source: {
      label: "Kadaster / PDOK",
      url: "https://api.pdok.nl/kadaster/bgt/ogc/v1/",
    },
    access:
      "Raadpleeg de bron voor de beschikbare downloads, licentie en eventuele toegangsvoorwaarden.",
    caveat:
      "Controleer objecttypen, bronhouder en downloadgebied; bestanden kunnen veel groter zijn dan een buurtselectie.",
    tags: ["BGT", "stoep", "gebouw", "water", "topografie"],
  },
  {
    id: "bestuurlijke-gebieden",
    title: "Gemeente- en provinciegrenzen",
    summary:
      "Officiële bestuurlijke gebiedsindelingen voor geografische selecties en koppelingen.",
    theme: "basis",
    publisher: "Kadaster / PDOK",
    coverage: "netherlands",
    level: "Gemeente / provincie",
    time: "Versie en peildatum bij de bron",
    formats: ["OGC API", "GeoJSON"],
    availability: "source",
    source: {
      label: "Kadaster / PDOK",
      url: "https://api.pdok.nl/kadaster/brk-bestuurlijke-gebieden/ogc/v1",
    },
    access:
      "Raadpleeg de bron voor de beschikbare downloads, licentie en eventuele toegangsvoorwaarden.",
    caveat:
      "Gebruik grenzen van het passende jaar; bestuurlijke gebieden zijn geen CBS-buurten.",
    tags: ["grenzen", "provincie", "gemeente", "gebied"],
  },
  {
    id: "bro-grondwater",
    title: "Grondwatermeetpunten en meetnetten",
    summary:
      "Kenmerken van meetpunten en meetnetten voor onderzoek naar grondwater.",
    theme: "klimaat",
    publisher: "BRO / PDOK",
    coverage: "netherlands",
    level: "Meetpunt / meetnet",
    time: "Per registratie",
    formats: ["OGC API", "GeoJSON"],
    availability: "source",
    source: {
      label: "BRO / PDOK",
      url: "https://api.pdok.nl/tno/bro-grondwatermonitoring-in-samenhang-karakteristieken/ogc/v1",
    },
    access:
      "Raadpleeg de bron voor de beschikbare downloads, licentie en eventuele toegangsvoorwaarden.",
    caveat:
      "Diepte, meetperiode en meetnetdekking verschillen. Een meetpunt geeft geen funderingsdiagnose voor een huis.",
    tags: ["bodem", "grondwater", "funderingscontext", "BRO"],
  },
  {
    id: "luchtfoto",
    title: "Open luchtfoto’s",
    summary:
      "Luchtbeelden als ondergrond om gebouwen, groen en terrein te bekijken.",
    theme: "basis",
    publisher: "PDOK",
    coverage: "netherlands",
    level: "Beeld / raster",
    time: "Opnamejaar bij de bron",
    formats: ["WMTS", "WMS", "Beeldbestanden"],
    availability: "source",
    source: {
      label: "PDOK",
      url: "https://www.pdok.nl/datasets",
    },
    access:
      "Raadpleeg de bron voor de beschikbare downloads, licentie en eventuele toegangsvoorwaarden.",
    caveat:
      "Een luchtfoto is een opname, geen actuele objectregistratie. Controleer beeldjaar, resolutie en gebruiksvoorwaarden.",
    tags: ["luchtfoto", "satelliet", "beeld", "RGB", "infrarood"],
  },
  {
    id: "ndw-verkeer",
    title: "Verkeerssnelheden en intensiteiten",
    summary:
      "Actuele verkeersgegevens, meetlocaties en mogelijkheden voor historisch verkeersonderzoek.",
    theme: "mobiliteit",
    publisher: "NDW",
    coverage: "netherlands",
    level: "Meetlocatie / weg",
    time: "Actueel; historie via bronproducten",
    formats: ["DATEX II", "XML", "Bestanden"],
    availability: "source",
    source: {
      label: "NDW",
      url: "https://opendata.ndw.nu/",
    },
    access:
      "Raadpleeg de bron voor de beschikbare downloads, licentie en eventuele toegangsvoorwaarden.",
    caveat:
      "Dekking verschilt per meetlocatie. Let op productversies en toegangsvoorwaarden voor historische gegevens.",
    tags: ["verkeersdrukte", "auto", "spits", "snelheid", "intensiteit"],
  },
  {
    id: "laadpunten",
    title: "Openbare laadpunten",
    summary:
      "Locaties van laadvoorzieningen en aanvullende producten voor elektrisch vervoer.",
    theme: "mobiliteit",
    publisher: "NDW",
    coverage: "netherlands",
    level: "Laadlocatie",
    time: "Bronstand en status per product",
    formats: ["GeoJSON", "OCPI JSON"],
    availability: "source",
    source: {
      label: "NDW",
      url: "https://opendata.ndw.nu/",
    },
    access:
      "Raadpleeg de bron voor de beschikbare downloads, licentie en eventuele toegangsvoorwaarden.",
    caveat:
      "Locatie, beschikbaarheid en tarief zijn verschillende producten; niet ieder gegeven heeft hetzelfde ophaalmoment.",
    tags: ["elektrisch", "laadpaal", "opladen", "EV"],
  },
  {
    id: "wegwerkzaamheden",
    title: "Wegwerkzaamheden en afsluitingen",
    summary:
      "Geplande werkzaamheden en verkeersmaatregelen voor onderzoek naar tijdelijke bereikbaarheid.",
    theme: "mobiliteit",
    publisher: "NDW",
    coverage: "netherlands",
    level: "Maatregel / weg",
    time: "Planning en status bij de bron",
    formats: ["DATEX II", "XML"],
    availability: "source",
    source: {
      label: "NDW",
      url: "https://opendata.ndw.nu/",
    },
    access:
      "Raadpleeg de bron voor de beschikbare downloads, licentie en eventuele toegangsvoorwaarden.",
    caveat:
      "Planningen kunnen veranderen; een vermelding is geen garantie voor de actuele situatie op straat.",
    tags: ["afsluiting", "hinder", "omleiding", "werkzaamheden"],
  },
  {
    id: "natura2000",
    title: "Natuurgebieden",
    summary:
      "Natura 2000-gebieden als aanvullende laag voor landschap en gebiedsonderzoek.",
    theme: "groen",
    publisher: "RVO / PDOK",
    coverage: "netherlands",
    level: "Gebied",
    time: "Versie bij de aanbieder",
    formats: ["OGC API", "Kaartlagen"],
    availability: "source",
    source: {
      label: "RVO / PDOK",
      url: "https://www.pdok.nl/datasets",
    },
    access:
      "Raadpleeg de bron voor de beschikbare downloads, licentie en eventuele toegangsvoorwaarden.",
    caveat:
      "Een natuurgrens is geen toegankelijkheidskaart of automatische conclusie over regels voor een afzonderlijk perceel.",
    tags: ["natuur", "Natura 2000", "beschermd", "landschap"],
  },
] satisfies RegistryEntry[];
