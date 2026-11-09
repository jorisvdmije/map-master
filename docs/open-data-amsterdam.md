# Open data Amsterdam

Een praktische selectie van officiële openbare databronnen voor Amsterdam,
gecontroleerd op 4 november 2026. Landelijke bronnen zijn op Amsterdam te filteren.
Dit is geen uitputtende inventaris. Controleer per bestand de licentie, actualiteit,
dekking, gebruikslimieten en benodigde registratie. Openbaar raadpleegbaar betekent
niet automatisch vrij in bulk te downloaden of onbeperkt te herpubliceren.

[Open het woningvoorbeeld](/analysis/housing/) of
[verken de straatmonitor](/analysis/streets/).

| Bron | Beschikbare gegevens / detailniveau | Nuttige toepassing | Aandachtspunt |
| --- | --- | --- | --- |
| [BAG · Kadaster / PDOK](https://www.kadaster.nl/zakelijk/producten/adressen-en-gebouwen/bag-ogc-api-s) | Adressen, panden, verblijfsobjecten, oppervlakte, gebruiksdoel, bouwjaar | Adresdetails, woningvoorraad, objecten ruimtelijk koppelen | Een pand kan veel woningen bevatten; tel woningen met unieke verblijfsobject-ID's. Geen bewoners of woningprijzen. |
| [CBS Kerncijfers wijken en buurten](https://opendata.cbs.nl/CBS/nl/dataset/86165NED/table) | Inwoners, woningen, gemiddelde WOZ, eigendom, energie en nabijheid van voorzieningen per buurt/wijk | Woningwaarde en buurtkenmerken vergelijken | Jaar en waardepeildatum verschillen; ontbrekende/onderdrukte cijfers zijn geen nul. Kies geometrie van hetzelfde jaar. |
| [Basisbestand Gebieden Amsterdam · O&S](https://onderzoek.amsterdam.nl/dossier/gebieden) | Kerncijfers voor Amsterdamse gebiedsindelingen | Buurtprofielen, verschillen tussen gebieden en jaren | Controleer gebiedscodes, grenswijzigingen en definities per indicator. |
| [Woningmarkt · O&S](https://onderzoek.amsterdam.nl/dataset/woningmarkt) | Woningvoorraad, woningtypen, woningwaarden en geaggregeerde transactiecijfers | Woningmarktontwikkeling en verschillen tussen stadsdelen | De gepubliceerde tabellen vormen geen compleet bestand met individuele koopsommen. |
| [Bomen · Gemeente Amsterdam](https://api.data.amsterdam.nl/v1/docs/datasets/bomen.html) | Boomlocaties en beheerkenmerken | Bomen in de buurt, boomsoorten, nabijheid bij woningen | Gemeentelijk beheerregister; geen volledige inventaris van particuliere bomen. |
| [Openbare verlichting en storingsstatus](https://api.data.amsterdam.nl/v1/docs/datasets/storingsmeldingen_ovl_en_klokken.html) | Lichtobjecten en geregistreerde storingsstatus | Verlichting rond adressen, storingspatronen | Objecten zijn geen luxmetingen; sommige typen zijn decoratieve verlichting. |
| [Meldingen openbare ruimte · MORA](https://api.data.amsterdam.nl/v1/docs/datasets/meldingen.html) | Openbare meldingscategorieën, meldingsdatum en visualisatielocatie | Concentraties, veranderingen en meldingen per honderd woningen | Niet alle categorieën of velden zijn openbaar; meldingsbereidheid verschilt. Geen criminaliteits- of veiligheidsmeting. |
| [Politie open data](https://www.politie.nl/algemeen/dataportaal/dataportaal-faq.html) | Geregistreerde misdrijven en overlaststatistiek, afhankelijk van tabel per buurt/wijk/gemeente | Ontwikkelingen in geregistreerde incidenten | Registraties zijn niet alle werkelijke incidenten en niet automatisch ervaren veiligheid. |
| [Luchtmeetnet · RIVM / GGD](https://api-docs.luchtmeetnet.nl/) | Meetstations en metingen van luchtverontreiniging | Tijdreeksen en blootstelling rond meetstations onderzoeken | Stationsmetingen gelden niet voor ieder adres; recente waarden kunnen voorlopig zijn. Fair-use-limiet. |
| [Atlas Leefomgeving](https://www.atlasleefomgeving.nl/kaarten) | Themakaarten, onder andere geluid, lucht en leefomgeving | Omgevingscontext bij woningen | Resolutie, modeljaar en downloadmogelijkheden verschillen per kaart; inspecteer de bronmetadata. |
| [Klimaateffectatlas](https://www.klimaateffectatlas.nl/nl/faq) | Kaarten over hitte, droogte, wateroverlast en overstroming | Woningen en kwetsbare gebieden met klimaatscenario's vergelijken | Modellen en scenario's zijn geen voorspelling van schade aan een individueel huis. |
| [AHN / PDOK](https://www.ahn.nl/open-data) | Hoogtemodellen, oppervlaktemodellen en puntenwolken | Terreinhoogte, hoogteverschillen, afgeleide schaduwstudies | Opnamedatum en resolutie verschillen; een hoogtekaart alleen bewijst geen wateroverlastrisico. |
| [Nationaal Wegenbestand · Rijkswaterstaat / PDOK](https://api.pdok.nl/rws/nationaal-wegenbestand-wegen/ogc/v1) | Wegvakken en wegkenmerken | Straatgroepering, ruimtelijke koppelingen en netwerkvoorbereiding | Niet elk pad en niet alle routeringsbeperkingen staan erin. |
| [NDW open data](https://opendata.ndw.nu/) | Onder meer verkeerssnelheden, intensiteiten en wegverkeersinformatie | Verkeersdrukte en tijdpatronen rond woongebieden | Meetpuntdekking en beschikbare producten verschillen; historische producten kunnen een account vereisen. |
| [EP-Online · RVO](https://ep-online.nl/PublicData) | Geregistreerde energielabels en energieprestatiegegevens | Labelverdeling, verduurzaming en woningkenmerken | Gratis API-key nodig voor bestanden; niet iedere woning heeft een geregistreerd, actueel label. |
| [Maps Amsterdam · open geodata](https://maps.amsterdam.nl/open_geodata/) | Verzameling gemeentelijke themabestanden en kaartlagen | Aanvullende thema's vinden en geografische lagen importeren | Controleer per dataset bron, actualiteit, formaat en hergebruikvoorwaarden. |

## Wat het woningvoorbeeld werkelijk gebruikt

De kaart op `/analysis/housing/` combineert:

1. CBS-buurtgeometrie **2025**, gemeente `GM0363`, via de PDOK OGC API;
2. CBS-tabel **86165NED**, exact gekoppeld op buurtcode, met onder andere gemiddelde
   WOZ, woningvoorraad, kooppercentage en afstand tot grote supermarkt;
3. actuele BAG-woonverblijfsobjecten, op verzoek geladen voor één geselecteerde buurt;
4. bouwjaren van de aan een geselecteerd verblijfsobject gekoppelde BAG-panden.

De vaste buurtmomentopname heeft 519 vlakken, 517 gekoppelde statistiekrijen en
430 bekende WOZ-gemiddelden. De twee watergebieden zonder statistiek worden
behouden. De WOZ-waardepeildatum bij CBS-jaar 2025 is **1 januari 2024**. De afstand
tot supermarkt is een door CBS berekende gemiddelde afstand over de weg, geen
hemelsbrede afstand vanaf het aangeklikte huis.

De BAG-laag telt unieke verblijfsobjecten met woonfunctie en een status in gebruik
of verbouwing. De bronrechthoek wordt achteraf met de echte buurtgeometrie
geknipt, inclusief polygonen met gaten en meerdere delen. Grenzen tellen mee;
een punt op een gedeelde grens kan bij beide afzonderlijke buurtopvragen horen.
Paginering moet volledig slagen voordat een nieuwe telling zichtbaar wordt. Tijdens het ophalen worden gelezen bronrecords en afgeronde bronpagina’s getoond; je kunt de opvraag annuleren. Na het laden kun je binnen de adressen zoeken op straat, huisnummer, postcode of volledige BAG-identificatie. Huisnummertokens worden niet tegen losse cijfers in een BAG-ID gematcht.
De BAG is actueel en de buurtgrens komt uit 2025. Verschillen met de historische
CBS-woningvoorraad zijn daarom **geen leegstandscijfers**.

### Meer gegevens, zonder een onleesbare kaart

Het woningvoorbeeld heeft nu **25 kaartlagen**, gegroepeerd in vijf thema’s:

| Thema | Zichtbare gegevens |
| --- | --- |
| Waarde & ontwikkeling | Gemiddelde WOZ en verandering tussen CBS-jaren 2024 en 2025, met buurtgrafiek voor 2023–2025 |
| Woningen & nieuwbouw | Aandeel bouwjaar afgelopen tien jaar, nieuwbouwwoningen toegevoegd in 2025, koop, huur, corporatiebezit, meergezinswoningen en woningen zonder BRP-inschrijving |
| Buurt & opleiding | Hbo/wo onder bekende onderwijsniveaus, inkomen per inwoner, personen in de landelijke laagste 40% inkomens, huishoudgrootte, kinderen, 65-plussers en adressendichtheid |
| Voorzieningen | Gemiddelde afstand over de weg tot supermarkt, huisarts, basisschool en kinderdagverblijf |
| Energie | Gasverbruik, elektriciteitslevering van het net, stadsverwarming, aardgasvrije woningen en woningen met zonnestroom |

Zoeken, minimum woningvoorraad en maximaal tien eigen voorwaarden werken samen
voor kaart, grafiek, gesorteerde lijst en export. Snelle filters helpen met
WOZ onder de stadsmediaan, recente bouw, voorzieningen dichtbij en lager gasverbruik.
De mediaan in de samenvatting volgt de gekozen kaartlaag en selectie. Ontbrekende
waarden worden bij een actieve getalgrens uitgesloten; zonder zo’n grens blijven
ze zichtbaar als onbekend. Negatieve WOZ-ontwikkeling blijft een geldige waarde.
De kleurverdeling gebruikt steeds alle Amsterdamse buurten; WOZ-ontwikkeling heeft
een symmetrische schaal met nul als midden. Selectie en kaartlaag wisselen
verplaatsen de camera niet.

De officiële CBS-tabellen zijn **85618NED (2023)**, **85984NED (2024)** en
**86165NED (2025)**. Voor WOZ-geschiedenis is dezelfde code onvoldoende: voor ieder
tussenliggend jaar moet de CBS-indelingsindicator `1` zijn (ongewijzigde code en
grens volgens CBS). Vier buurten met een gewijzigde indeling in 2024 krijgen
bijvoorbeeld geen vergelijkbare WOZ-waarneming uit 2023. Een verandering in het
buurtgemiddelde kan nog steeds komen door veranderingen in woningmix; het is geen
herhaalde verkoopprijsindex.

Opleiding en inkomenscijfers in de 2025-tabel waren bij deze extractie niet
gepubliceerd. Deze drie indicatoren komen uit de **2024-tabel**, uitsluitend voor
ongewijzigde buurten. Onderwijs is het aandeel hbo/wo binnen de drie gepubliceerde
onderwijsniveaus voor 15–74-jarigen; alle drie aantallen moeten bekend zijn.
De laagste 40% is een landelijke inkomensgroep, geen armoedepercentage. Inkomen
wordt alleen in voldoende grote buurten gepubliceerd. De kaart toont per laag
het tabeljaar, de definitie, dekking en bronlink. Een apart waarnemingsjaar wordt
alleen vastgelegd wanneer de actuele bronmetadata dat specificeert; bij energie
is dat afzonderlijke jaar niet vermeld.

De export naar GeoJSON bevat indicatorbeschrijvingen, bronjaren, bronqueries,
hashes, WOZ-historie en gebruikte filters. De CSV bevat alle 25 getalskolommen,
met eenheid en CBS-tabeljaar in de kolomnaam; lege cellen blijven onbekend.

### Erfpacht en toeristische verhuur bij een adres

Bij een gekozen BAG-woning kun je **Erfpacht & vakantieverhuur** openklappen.
Pas dan worden twee echte gemeentelijke openbare bronnen opgevraagd:

- [Erfpachtuitgevers per perceel](https://api.data.amsterdam.nl/v1/docs/datasets/benkagg.html#brkkaartlaagerfpachtuitgevers):
  een ruimtelijke match tussen het BAG-punt en de perceelgeometrie, met categorie
  Gemeente Amsterdam of Overige. De match bewijst geen individueel
  appartementsrecht; canon, afkoop en tijdvak zijn niet gekoppeld.
- [B&B-beschikbaarheid per vergunningswijk](https://api.data.amsterdam.nl/v1/docs/datasets/vergunningen.html#bedandbreakfast):
  een officiële beschikbaarheidsindicatie voor de wijk waarin het BAG-punt ligt.
  Dit is geen vakantieverhuurvergunning, verhuuractiviteit of Airbnb-telling op
  dit adres. Een punt op meerdere wijkgrenzen krijgt geen eenduidige wijkstatus.

Geen kaartmatch betekent onbekend, nooit eigen grond of verhuurverbod. Alle
bronpagina’s moeten slagen; de geometrie wordt ook lokaal gecontroleerd. Fouten
leveren een herhaalbare foutstatus en geen gedeeltelijke uitkomst op. De bronwaarde `Amsterdam` wordt zichtbaar als `Gemeente Amsterdam`, met de originele waarde bewaard in de export als `rawIssuer`. De aparte
JSON-export bewaart de context, bron en ophaaldatum; officiële raadpleeglinks
staan naast de ontbrekende individuele gegevens. Het eerdere B&B-demovoorbeeld
blijft fictief en wordt niet als bron voor het woningvoorbeeld gebruikt.

### Gemeentelijke belastingen zelf doorrekenen

De inklapbare rekenhulp gebruikt de
[officiële Amsterdamse tarieven 2026](https://www.amsterdam.nl/belastingen/belastingtarieven-2026),
gecontroleerd op 4 november 2026. Bij een gewone woning voor een volledig jaar
berekent deze OZB voor de eigenaar (0,0527% van de zelf ingevoerde WOZ), het vaste
eigenaarsdeel riool (€ 192,04) en afval (€ 352 voor één persoon of € 469 voor meer
personen). Huurders betalen in dit model alleen de afvalstoffenheffing. Er wordt
**geen buurt-WOZ automatisch ingevuld**; de eigenaar voert het bedrag van de eigen
WOZ-beschikking 2026 in. Lege, ongeldige of niet-positieve invoer geeft geen totaal.

Het resultaat is een uitgesplitst indicatief subtotaal per jaar en maand, geen
aanslag. De afbakening is maximaal 300 m³ watergebruik per jaar, zonder
kwijtschelding; waterschap, erfpacht en andere woonlasten vallen erbuiten.

Vernieuwen: `npm --prefix website run data:housing`, daarna de website bouwen.
De snapshot bewaart query-URL's, ophaaldatum, bronpagina-hashes en de hash van de
gekoppelde gegevens. De build controleert die laatste hash.

## Goede analyses met deze bronnen

### Omgevingsgegevens bij een woning

Het woningvoorbeeld haalt nu bij een gekozen BAG-woning ook drie aanvullende
bronnen op: gemeentelijke boomregistraties binnen 100 of 250 meter, de RIVM-rasterwaarde
voor geluid en gemeentelijke energielabelregistraties. Iedere bron houdt een eigen
ophaalmoment en foutstatus. De export bewaart ontbrekende waarden en provenance.

De [gemeentelijke energielabelbron](https://api.data.amsterdam.nl/v1/docs/datasets/duurzaamheid.html)
is op dit moment zonder sleutel toegankelijk. Dit is een andere toegang dan de
EP-Online-bestanden waarvoor een gratis sleutel nodig is. De laatste geregistreerde
labeldatum wordt getoond, met geldigheidsdatum; verlopen, ontbrekende en ambigue
labels worden niet als geldige actuele labels gepresenteerd. API-beleid kan veranderen.

Voor geluid wordt de vaste RIVM-laag `rivm_20250801_Geluid_lden_allebronnen_2022`
gebruikt. Deze samengestelde kaart bevat verschillende bronjaren (2022–2025).
De rasterwaarde op het BAG-punt is geen gevelmeting, actuele geluidshinder of
wettelijke toets. Zie de [toelichting van Atlas Leefomgeving](https://www.atlasleefomgeving.nl/veelgestelde-vragen).
De boomtelling omvat alleen geregistreerde gemeentelijke bomen, geen particuliere
bomen of oppervlakte boomkroon. De afstand is geodesisch en hemelsbreed.

Via **Bereikbaarheid vanaf dit adres** start de nieuwe
[netwerkreistijdanalyse](/analysis/reachability/) met dat adres als vertrekpunt.

### Verdere onderzoeksvragen

- Onderzoek verbanden tussen **buurtgemiddelde** WOZ en eigendom, woningmix,
  adressendichtheid of nabijheid van voorzieningen, met dezelfde complete buurten
  voor correlatie en grafiek. Het voorbeeld gebruikt ongewogen Pearson r, pas bij
  vijf complete paren en variatie op beide assen.
- Bereken bij een passende, gelijktijdige gegevensbasis meldingen per honderd
  woningen of het aantal woningen binnen een onderzoeksgebied.
- Koppel aanvullende gegevens bij voorkeur via stabiele BAG-identificaties of
  officiële gebiedscodes, in plaats van alleen met straatnamen.
- Gebruik voor een latere individuele prijsanalyse echte prijsgegevens, vergelijkbare
  woningen, verkoop-/waardejaar en passende correcties voor onder andere oppervlakte,
  bouwjaar, woningtype en ligging. Buurtgemiddelden beantwoorden een andere vraag.

De nieuwe functies voor identificatie-indexen, punt-in-gebiedselectie en correlatie
zijn brononafhankelijk in de analysevoorbeelden ondergebracht. De geometrie-editor
zelf krijgt geen ingebakken Amsterdamse adressendatabase of overheids-API-verplichting.

## Woningwaarde: welke bron mag waarvoor?

Het [WOZ-waardeloket](https://www.waarderingskamer.nl/woz-wijzer/controleren-woz-waarde/woz-waardeloket)
is openbaar voor individuele raadpleging; massaal of geautomatiseerd onttrekken
is niet toegestaan. Het woningvoorbeeld gebruikt dat loket niet als databron.

[Koopsominformatie van het Kadaster](https://www.kadaster.nl/woz-waarde-vergelijken)
is een afzonderlijk, betaald product. De CBS-WOZ-gemiddelden zijn geen gerealiseerde
verkoopprijzen, vraagprijzen of individuele taxaties. Aan een woning wordt in het
voorbeeld geen gefingeerde waarde toegekend.
