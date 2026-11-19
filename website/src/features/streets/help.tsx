import { Check } from "lucide-react";
import { Modal } from "@/features/analysis/modal";
import {
  descriptions,
  labels,
  metrics,
  snapshot,
  observationMeta,
  units,
  legendLabels,
} from "./model";
import { number } from "./format";

export function Help({ close }: { close: () => void }) {
  return (
    <Modal
      title="Straatmonitor · bronnen & methode"
      close={close}
      className="st-help"
    >
      <div className="an-intro-body">
        <p className="st-help-lead">
          Echte gemeentelijke registraties, gekoppeld aan{" "}
          {number(snapshot.count)} NWB-wegvakken. Download:{" "}
          {observationMeta.retrieved}. Geen fictieve cijfers of samengestelde
          veiligheidsscore.
        </p>
        <h3>Bronnen en koppeldekking</h3>
        <p>
          Alle pagina’s zijn opgehaald en op unieke bron-ID gecontroleerd. Deze
          tabel beschrijft de hele download, onafhankelijk van je filters. Bomen
          in parken of lampen ver van een weg hoeven niet aan een straat
          gekoppeld te zijn.
        </p>
        <div className="st-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Bron</th>
                <th>Bronrecords</th>
                <th>Gekoppeld</th>
                <th>Twijfel</th>
                <th>Te ver</th>
                <th>Uitgesloten / ongeldig</th>
              </tr>
            </thead>
            <tbody>
              {observationMeta.sources.map((source) => (
                <tr key={source.key}>
                  <td>
                    <a
                      href={source.documentation}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {source.key === "lights"
                        ? "Verlichting"
                        : source.key === "trees"
                          ? "Gemeentelijke bomen"
                          : "MORA-meldingen"}
                    </a>
                  </td>
                  <td>{number(source.total)}</td>
                  <td>{number(source.matched)}</td>
                  <td>{number(source.ambiguous)}</td>
                  <td>{number(source.unmatched)}</td>
                  <td>{number(source.excluded + source.invalid)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3>Wat meten de indicatoren?</h3>
        <ul>
          {metrics.map((m) => (
            <li key={m}>
              <b>
                {labels[m]} ({units[m]}):
              </b>{" "}
              {descriptions[m]}
            </li>
          ))}
        </ul>
        <p>
          Meldingen beslaan {observationMeta.reportStart} tot{" "}
          {observationMeta.reportEndExclusive} (exclusief); je kunt de laatste 3
          of 12 volledige maanden kiezen. Bomen en objectstatus zijn de stand
          bij download, geen historie uit dezelfde periode. Afhandeldatums zijn
          niet openbaar beschikbaar in deze API; daarom berekenen we geen
          afhandeltijden.
        </p>
        <h3>Hoe worden punten aan straten gekoppeld?</h3>
        <p>
          Elk punt krijgt hoogstens één dichtstbijzijnd bronwegvak binnen 30 m.
          Liggen twee verschillende straatnamen binnen 3 m van dezelfde beste
          afstand, dan wordt het punt als twijfelgeval uitgesloten.
          Autobaanhoofdrijbanen, op- en afritten zijn uitgesloten van de
          koppeling. Voor verlichting tellen de geregistreerde typen Gevel
          Armaturen, LSD Objecten, Grachtmast, Overspanning en Schijnwerpers
          mee; Laadzuilen zijn uitgesloten. We tellen bronobjecten, geen
          afzonderlijke lampen. LSD omvat lichtkunst, stadsilluminatie en
          decoratieve verlichting; deze bron is dus geen zuivere inventaris van
          functionele straatlampen. De bomenbron bevat gemeentelijke
          registraties en geen volledige inventaris van particuliere bomen. MORA
          gebruikt publiek beschikbare visualisatiecoördinaten: dit is een
          benadering van de meldlocatie.
        </p>
        <p>
          Nul gekoppelde registraties bewijst niet dat een straat geen bomen,
          lichtobjecten of overlast heeft. Een ontbrekend storingspercentage
          betekent minder dan 5 bekende objectstatussen. De brondekking is geen
          percentage van alle werkelijke objecten; we kennen dat totaal niet.
        </p>
        <h3>Straten, gebieden en noemers</h3>
        <p>
          We tellen eerst alle bronaantallen in je geografische selectie op.
          Percentages delen storingen door bekende objectstatussen; dichtheden
          delen aantallen door bronwegvaklengte. Parallelle rijbanen tellen
          apart in die lengte. Daarom staat er expliciet “NWB” bij de eenheid.
          Daarna selecteren zoek-, kleur- en profielfilters hele straten. Een
          exact gelijke straatnaam vormt één object, ook als losse delen
          bestaan. De overzichtslijn onderdrukt nabije parallelle lijnen en
          verbindt eindpunten tot 38 m; dit is een cartografische
          vereenvoudiging. Originele lijnen blijven zichtbaar bij de details en
          in GeoJSON.
        </p>
        <p>
          De 110 gebiedspolygonen zijn dezelfde B&B-vergunningsgebieden als in
          het andere voorbeeld. Een representatief punt wijst elk heel
          bronwegvak aan één gebied toe; grensoverschrijdende lijnen worden niet
          geknipt. Een wijkfilter toont het toegewezen straatdeel.
        </p>
        <h3>Kleuren en aandachtssignalen</h3>
        <p>
          De grenzen zijn illustratieve instelkeuzes van deze toepassing, geen
          gemeentelijke normen. De paarse signaalklasse bij weinig bomen/lampen
          of veel storingen/meldingen is een verkenningssignaal. Meer
          lichtobjecten of minder meldingen bewijst geen hogere kwaliteit.
        </p>
        <ul>
          {metrics.map((m) => {
            const legend = legendLabels(m);
            return (
              <li key={m}>
                {labels[m]}: signaalgrens {legend.poor}, tussenklasse{" "}
                {legend.medium}, buiten signaalgrens {legend.good} {units[m]}.
              </li>
            );
          })}
        </ul>
        <p>
          “Minstens 2 aandachtssignalen” telt: storingen ≥10%, boomdichtheid
          &lt;1/100 m NWB en meldingsdruk ≥4/100 m NWB/maand. Er moeten minstens
          twee grenzen geraakt zijn. Zonder voldoende objectstatussen telt het
          storingssignaal niet mee.
        </p>
        <h3>Concentratiekaarten</h3>
        <p>
          Deze weergave gebruikt echte bronlocaties, gebundeld in vakken van 25
          × 25 m. Alle aantallen blijven behouden; een punt markeert het midden
          van een bronvak en is geen exacte individuele bronlocatie. Alleen
          records die aan de huidige straatselectie zijn gekoppeld tellen mee.
          Ruis en twijfelgevallen blijven uitgesloten zoals hierboven
          beschreven. Onderwerpen zijn alle meldingen, overlast,
          wegen/onderhoud, bomen, verlichtingsobjecten en storingen.
        </p>
        <p>
          Een Gaussische vervaging gebruikt een radius van 100, 250 of 500
          meter. De kleuren tonen relatieve gewogen concentratie, geen kans,
          percentage of statistisch getoetste hotspot. De schaal gebruikt de
          stadsbrede 95e percentielwaarde van radiusgrote vakken, voor meldingen
          steeds over 12 maanden. Filteren, de camera verplaatsen of 3 maanden
          kiezen schaalt de kaart dus niet automatisch op. Onderwerp, radius of
          contrast wijzigen de schaal wel. Kleuren kunnen over straat- of
          wijkgrenzen uitvloeien. Bij inzoomen gaat de vervaging geleidelijk
          over in afzonderlijke bronvakken. Storingsconcentratie is een aantal;
          het percentage storingen blijft beschikbaar bij de straatindicatoren.
          De extra GeoJSON-export bewaart de gewogen bronvakken en
          weergave-instellingen.
        </p>
        <h3>Hexagonen</h3>
        <p>
          Bij “Concentraties → Hexagonen” tellen we de 25 m-bronvakken op binnen
          een vast, zeshoekig raster. De vakbreedte van 100, 250 of 500 meter is
          de afstand tussen parallelle zijden. Elk bronvak valt eenmaal in één
          hexagon; alle aantallen blijven behouden. Toewijzing gebruikt het
          midden van het bronvak en is daardoor bij hexagongrenzen een
          benadering van de oorspronkelijke bronlocaties. De hexagonen
          veranderen niet bij inzoomen of verplaatsen en worden niet op
          wijkgrenzen geknipt. Alleen vakken met gekoppelde registraties worden
          getoond.
        </p>
        <p>
          De kleuren tonen aantallen per hexagon, met een vaste stadsbrede
          12-maandsreferentie op het 95e percentiel van niet-lege hexagonen. De
          bovengrens op de legenda volgt het contrast; hogere aantallen delen de
          donkerste kleur, maar behouden hun volledige getal in details en
          export. Onderwerp en vakmaat hebben elk hun eigen schaal. Vergelijk
          daarom steeds dezelfde instellingen. Bij voldoende zoom verschijnen
          aantallen in de vakken. Selecteren zoomt niet. De extra GeoJSON-export
          bevat echte hexagonpolygonen, niet alleen middelpunten.
        </p>
        <h3>Verbanden en clusters</h3>
        <p>
          Pearson gebruikt de oorspronkelijke waarden; Spearman gebruikt
          rangordes met gelijke rangen bij gelijke waarden. Minstens 3 complete
          meetparen en variatie zijn nodig. Elke straat of elk gebied telt
          eenmaal. De minimale bronlengte is standaard 100 m en geldt ook voor
          het analyseverslag. Logaritmische assen gebruiken log(1+x), inclusief
          nul; dit verandert de berekende correlatie niet. Er is geen fictieve
          druktecorrectie, significantietoets of causale effectschatting.
          Dichtheden delen dezelfde lengtenoemer; dat kan zelf samenhang
          veroorzaken. Overlastmeldingen zijn een subset van het totaal; hun
          onderlinge samenhang is deels rekenkundig.
        </p>
        <p>
          K-means gebruikt straten van minimaal 100 m, met lichtobjectdichtheid,
          boomdichtheid en meldingsdruk. Eerst log(1+x), daarna z-scores,
          deterministische initialisatie en maximaal 60 iteraties. Het model
          gebruikt de hele stad; filters veranderen de training niet. Een andere
          meldingsperiode of ander aantal clusters wel. Clustercentra zijn
          terugvertaalde gemiddelden in logruimte, geen gewone rekenkundige
          gemiddelden.
        </p>
        <h3>Verschuivingsradar</h3>
        <p>
          We vergelijken de laatste drie volledige maanden met de eerdere negen.
          Referentie = eerdere meldingen van de straat × recente meldingen in de
          rest van Amsterdam / eerdere meldingen in de rest van Amsterdam. De
          straat zelf telt niet mee in de stadsreferentie; filters en het
          periodekeuzemenu veranderen de referentie en vensters niet. Een
          wijkfilter onderzoekt alleen het toegewezen straatdeel. Verschil =
          recent minus referentie; relatief verschil = verschil / referentie ×
          100%.
        </p>
        <p>
          De ranglijst gebruikt minimaal 100 m NWB, 5 eerdere meldingen, 5
          referentiemeldingen en het gekozen minimumjaartotaal. Straten met
          beperkte basis blijven in de tabel en CSV, met een uitsluitreden.
          Rangschik op extra aantallen om omvang te zien, of op procentueel
          verschil om relatieve verandering te verkennen. Eén jaar bevat geen
          herhaalde lokale seizoenen: deze vergelijking verklaart geen oorzaken
          en is geen prognose of significantietoets. De stad kan bovendien uit
          meerdere gelijktijdige lokale veranderingen bestaan.
        </p>
        <h3>Exports en reproduceerbaarheid</h3>
        <p>
          CSV en GeoJSON bewaren de geselecteerde straten of bronwegvakken,
          bronaantallen, eenheden, perioden, noemers en herkomst. Het
          JSON-verslag bevat ook broncontroles, methoden, filters en
          clustercentra. Bronpagina’s zijn gehasht; de download kan via het
          script opnieuw worden opgebouwd. De kaart gebruikt een lokale snapshot
          en is geen live storingsmonitor.
        </p>
      </div>
      <div className="an-intro-actions">
        <button className="an-button an-primary" onClick={close}>
          Aan de slag <Check size={14} />
        </button>
      </div>
    </Modal>
  );
}
