# HA Flow Builder

Homey-achtige **Advanced Flows** voor Home Assistant. Bouw automatiseringen op een canvas met kaarten:
**ALS** (trigger) → **EN** (voorwaarde, met ja/nee-uitgang) → **DAN** (actie).

Kies eerst een apparaat, bijvoorbeeld "Haldeur sensor". Daarna zie je alleen de kaarten die bij dat apparaat horen, zoals "geopend", "gesloten" of "batterij laag". Die kaarten komen rechtstreeks uit Home Assistant en zijn in je eigen taal.

Elke flow wordt opgeslagen als **gewone Home Assistant-automation** in `automations.yaml` (id `flowey_…`). Home Assistant voert de flow dus zelf uit, met traces, run-modes en alles wat daarbij hoort. De visuele indeling (posities en verbindingen) bestaat alleen in dit paneel.

## Installeren

1. Kopieer `custom_components/ha_flow_builder` naar de map `config/custom_components/` van je Home Assistant.
   Later kan dit ook via HACS als custom repository.
2. Herstart Home Assistant.
3. Ga naar *Instellingen → Apparaten & diensten → Integratie toevoegen → HA Flow Builder*.
4. In de zijbalk verschijnt **Flows** (alleen voor beheerders).

Je configuratie moet `automation: !include automations.yaml` bevatten. Dat staat standaard in elke installatie.

## Kaarten

| Als… | En… | Dan… |
|---|---|---|
| Apparaat (alle apparaattriggers van HA) | Apparaat is… | Apparaat (alle apparaatacties van HA) |
| Entiteit verandert (ook helpers) | Entiteit is… | Lamp (aan/uit, dimmen naar %, feller/donkerder, kleurtemperatuur, overgang) |
| | | Actie (elke HA-service) |
| Tijdstip (+ weekdagen) | Waarde boven/onder | Melding sturen (HA, telefoon, meldingsentiteit) |
| Interval | Tijd & dagen | Webhook (Homey-flow starten of elke URL aanroepen) |
| | | Wachten |
| Zon (op/onder ± verschuiving) | Zon (na/voor ± verschuiving) | |
| Weer (wordt regen/zonnig/…, temperatuur/wind/vochtigheid boven/onder) | Weer | |
| Aanwezigheid (iemand komt/vertrekt, eerste komt/laatste vertrekt, per zone) | Aanwezigheid (iemand/niemand, personen wel/niet in zone) | Wacht tot… (met maximum; uitgangen *gebeurd* / *tijd verstreken*) |
| Webhook ontvangen (bijv. vanuit Homey) | Timer loopt | Timer (starten, stoppen, pauzeren) |
| Timer afgelopen | | Herhaal (x keer, zolang/totdat; uitgangen *herhaal* / *klaar*) |

Regels op het canvas:
- Meerdere lijnen uit één uitgang lopen **parallel**.
- Meerdere triggers mogen op dezelfde kaart uitkomen ("A **of** B → doe X").
- Paden samenvoegen ná een voorwaarde of actie kan in v1 niet (de editor staat het niet toe).

## Recept: licht op beweging

Eén flow met twee triggers:

- **ALS** PIR *bezet* → **DAN** 💡 Lamp: aan op 40 %
- **ALS** *Entiteit verandert*: PIR van `on` naar `off`, **minstens 2 min lang** → **DAN** 💡 Lamp: uit (overgang 3 s)

Let op de richting: "van off naar on, 2 min lang" betekent "al 2 minuten beweging" en zet het licht dus uit terwijl je er nog bent.
Toont de Lamp-kaart dat HA een lamp niet als dimbaar ziet, dan negeert HA de helderheid; controleer dan in HA (Ontwikkelhulpmiddelen → Toestanden) de `supported_color_modes` van die lamp.

## Wacht tot…

De kaart **Wacht tot…** wacht tot er iets gebeurt (dezelfde keuzes als een ALS-kaart), eventueel met een maximale wachttijd.
Via **gebeurd** gaat de flow verder als het gebeurde, via **tijd verstreken** als het maximum bereikt is.

Voorbeeld licht op beweging in één flow: **ALS** beweging → 💡 aan → **Wacht tot** *geen beweging, 2 min lang* → 💡 uit.
Met de flow-instelling *Opnieuw starten als hij al loopt* begint het wachten opnieuw bij nieuwe beweging.
Let op: een lopende wachttijd overleeft geen herstart van Home Assistant.

## Timers (overleven een herstart)

Een **timer** is een HA-helper die aftelt, zoals Homey's Countdown. Maak hem direct in de kaart aan met *＋ Nieuwe timer*.
Robuuste variant van licht op beweging, met twee triggers:

- **ALS** beweging → 💡 aan + ⏲️ Timer *Nalooptijd* starten (opnieuw starten begint het aftellen opnieuw)
- **ALS** ⏲️ *Nalooptijd* afgelopen → 💡 uit

Anders dan *Wacht tot…* loopt een timer door als Home Assistant herstart; was hij intussen afgelopen, dan start de flow direct na de herstart.

## Herhaal

De kaart **Herhaal** herhaalt de kaarten aan de uitgang *herhaal* een vast aantal keer, of zolang/totdat een voorwaarde geldt (met een maximum als vangnet). Daarna gaat de flow verder via *klaar*.

## Handig

- **Test** vraagt bij een flow met meerdere triggers welke trigger je wilt nabootsen, en voert de flow uit alsof die gebeurde.
- **Kopiëren/plakken**: selecteer kaarten en gebruik Ctrl+C / Ctrl+V (ook naar een andere flow), of Ctrl+D / ⧉ *Dupliceren*. Een gekopieerde webhook-trigger krijgt automatisch een nieuw geheim adres.
- **Overzicht**: per flow zie je wanneer hij het laatst liep en of dat lukte; 🔍 opent de traces, ⧉ dupliceert de flow (de kopie staat uit tot je hem aanzet).

## Homey → Home Assistant (webhook ontvangen)

Met de ALS-kaart **Webhook ontvangen** start Homey (of een andere dienst) een flow in Home Assistant:

1. Voeg de kaart toe; er wordt een geheim adres gemaakt, bijv. `http://homeassistant.local:8123/api/webhook/flowey_…`.
2. Laat Homey een webverzoek (POST) naar dat adres sturen, bijvoorbeeld met een kaart uit de app *HTTP request flow cards*.
3. Meegestuurde gegevens gebruik je verderop met `{{ trigger.json.naam }}`.

Standaard werkt het adres alleen vanuit je eigen netwerk (Homey Pro). Voor Homey Cloud zet je dat uit en gebruik je het externe adres van Home Assistant (bijv. Nabu Casa). Het webhook-ID werkt als wachtwoord.

## Apparaten hernoemen

Bij elke apparaatkaart staat **✏️ Apparaat hernoemen**. De naam wordt in Home Assistant zelf aangepast (net als via Instellingen → Apparaten) en is dus overal in HA zichtbaar. Entiteit-ID's blijven gelijk, zodat bestaande automations en dashboards blijven werken. Met *Oorspronkelijke naam herstellen* ga je terug naar de naam van de integratie.

## Homey-apparaten aansturen (webhook)

Met de kaart **Webhook** start je vanuit een flow een flow op je Homey:

1. Maak in Homey een flow die begint met de webhook-kaart (zoek bij een nieuwe flow op "webhook") en kies een eventnaam, bijv. `tuinlampen_aan`.
2. Kopieer de webhook-URL van Homey (formaat `https://webhooks.athom.com/webhook/<id>?homey=<homey-id>&event=<event>`) en plak die in de Webhook-kaart. Webhook-ID, Homey-ID en event worden dan automatisch ingevuld.
3. Druk op **Nu versturen (test)** om de koppeling te testen.

De tag kan een template zijn, bijv. `{{ states('sensor.temperatuur') }}`, en is in de Homey-flow te gebruiken.
Met **Andere webservice** roep je elke URL aan (GET/POST/PUT/PATCH/DELETE, headers, JSON- of tekstbody).
Onder water gebruikt de flow de actie `ha_flow_builder.call_webhook`, die je ook in gewone HA-automations kunt gebruiken.
Een mislukte aanroep (HTTP-fout, time-out) is zichtbaar in de trace van de automation.

Let op: headers (bijvoorbeeld een API-sleutel) worden net als de rest van de automation leesbaar opgeslagen in `automations.yaml`.

## Goed om te weten

- **Automatisch opslaan**: elke wijziging wordt na ongeveer een seconde opgeslagen. Een complete flow wordt direct in HA bijgewerkt; een onvolledige flow blijft een concept en de automation houdt zijn laatste werkende versie. Alleen kaarten verschuiven raakt HA niet.
- **Taal**: kies rechtsboven in het overzicht *Nederlands*, *English* of *zoals Home Assistant*. Ook de apparaatkaarten ("sensor geopend") volgen deze taal, los van de taal van je HA-profiel.

- **Gewijzigd in YAML**: bewerk je de automation buiten dit paneel (in YAML of de HA-editor), dan toont het paneel dat. Voordat opslaan vanaf het canvas die wijziging overschrijft, vraagt het paneel om bevestiging.
- **Concept**: een onvolledige flow wordt opgeslagen als concept en is nog niet actief.
- **▶ Test** voert de acties direct uit en slaat de triggers over. Bij meerdere triggers met elk een eigen pad doet een test daarom niets; gebruik dan **Traces**.

## Ontwikkelen

```bash
cd frontend
npm install
npm test          # compiler-tests (Vitest)
npm run build     # typecheck + bundel naar custom_components/ha_flow_builder/static/flow_builder.js
npm run dev       # bouwt opnieuw bij elke wijziging
```

Structuur:
- `frontend/src/compiler/`: graph → HA automation config (zonder UI-afhankelijkheden en getest).
- `frontend/src/canvas/`: editor (React Flow), kaarten, palet.
- `frontend/src/inspector/`: formulieren per kaarttype, apparaat → kaart → extra velden.
- `frontend/src/api/ha.ts`: websocket/REST-aanroepen naar Home Assistant.
- `custom_components/ha_flow_builder/`: dunne integratie met panel, opslag van de canvas-indeling (met migratie vanaf v0.4) en websocket-API.

Na een nieuwe build is een herstart van Home Assistant nodig voordat browsers de nieuwe bundel laden (cache-busting via `?v=`).
