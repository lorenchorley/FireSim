/**
 * Static text content: the safety notice, weather presets and historic replays offered in Setup, the Help tab's how-to
 * list and glossary, data attributions & licences and research references (About). Wording follows doc 10 §10.1: plain
 * words, "about" for numbers, never "you are safe".
 */
import { PRESET_IDS, WEATHER_PRESETS as SCENARIO_PRESETS } from '../scenario/presets';
import { REPLAYS as SCENARIO_REPLAYS } from '../scenario/replays';
import { ATTRIBUTION as RECORD_ATTRIBUTION } from '../scenario/recordKit';


/** Bump when the safety notice wording changes, so users see and accept it again. */
export const NOTICE_VERSION = 1;

export const SAFETY_NOTICE = {
  title: 'Training aid only',
  lead: 'FireSim is an education tool for learning how bushfires behave in mountain country.',
  points: [
    'It is not an operational prediction. Do not use it to make decisions on a fireground.',
    'Always follow your Incident Controller, your Crew Leader and NSW RFS procedures.',
    'Models are simplified and can be wrong — especially on steep slopes, in gullies and in extreme weather, where real fires are often faster than any model.',
    'LACES first: Lookouts, Awareness, Communications, Escape routes, Safety refuges.',
  ],
  accept: 'I understand — training use only',
};

export interface PresetOption {
  id: string;
  name: string;
  description: string;
  /** Local (LMST) start hour of the preset's canonical day (24 h). */
  startHour: number;
  /** Canonical local month (1–12) and day the preset is designed for (sun angle, curing; the FBI chip is defined there). */
  month: number;
  day: number;
  /** Rating the preset produces at its chip time, for the card chip. */
  rating: 'Moderate' | 'High' | 'Extreme' | 'Catastrophic' | 'No rating';
}

/**
 * Weather presets offered in Setup: the scenario builder's catalogue (src/scenario/presets, spec §11.3), so ids,
 * names and the rating chip always match what the builder runs.
 */
export const WEATHER_PRESETS: PresetOption[] = PRESET_IDS.map((id) => {
  const p = SCENARIO_PRESETS[id];
  return { id, name: p.name, description: p.description, startHour: p.canonical.startLmst, month: p.canonical.month, day: p.canonical.day, rating: p.chip.rating };
});

export interface ReplayOption {
  /** Replay id resolved by the scenario builder (WeatherMode { kind: 'replay' }): `<siteId>-<yyyy-mm-dd>`. */
  id: string;
  siteId: string;
  date: string;
  name: string;
  description: string;
}

/** Historic fire days with bundled hourly weather (public/replays/): the scenario builder's catalogue (§11.4). */
export const REPLAYS: ReplayOption[] = SCENARIO_REPLAYS.map((r) => ({ id: r.id, siteId: r.site, date: r.date, name: r.name, description: r.story }));

/** One line of the Help tab's "How to use" list: a bold label and what to do. */
export interface HelpStep {
  label: string;
  text: string;
}

/** The Help tab's "How to use" list, in the order shown (the dock's Help tab draws it; the words of the icons are in the glossary). */
export const HELP_STEPS: readonly HelpStep[] = [
  {
    label: 'Tools',
    text: 'the Tools button at the bottom of the map opens Why here?, Fire, Fuel, Wind, Layers, What if and Air slices. Tap the map for “Why here?” without choosing anything. Tap an icon to ask about it: the panel then starts with the icon as drawn on the map and its name, and the ring jumps onto it. Tap the ground beside an icon and there is no icon row. The words of the icons are in the Glossary, under Map icons.',
  },
  { label: 'Fire', text: 'tap the map (or use the crosshair) to mark where the fire is; draw a line for a fire edge.' },
  { label: 'Play', text: 'press the blue Play button and pick a speed on the chip beside it; drag or tap the timeline to jump to any time.' },
  {
    label: 'If it runs slowly',
    text: 'when the simulation cannot keep up with your playback speed, a small gauge button appears at the right end of the timeline. Tap it to see why and what you can do. It never changes the result.',
  },
  {
    label: 'Moving around the map',
    text: 'drag with one finger to slide the map along, like grabbing a paper map. Put two fingers on it and move them together to turn the view (sideways) and tilt it (up or down), or pinch them to zoom; you can pinch and turn in one movement. At eye level you cannot slide: one finger turns your head. While “Draw a line” (Fire) or “Paint” (Fuel) is on, one finger draws and the map stays still; switch back to tapping to move the map again. With a mouse: left button slides, right button turns, wheel zooms.',
  },
  { label: 'Map buttons', text: 'the round buttons on the side open the layers, change the camera (top, 3-D, eye level, zoom) and turn the map north up.' },
  { label: 'Insights', text: 'new cards never pop up; a number on the Insights tab tells you how many are waiting.' },
  { label: 'Fuel / Wind', text: 'tell the model what you see: more litter, a road, the wind here.' },
  {
    label: 'Layers',
    text: 'choose the map type, switch roads, fire trails, homes, residential areas, names and trees on or off one by one, or colour the ground by one measurement (a heat map). After dark, Night lighting (under Map type) can light the ground, trees and roads so the terrain stays easy to read. Tap (i) on a row to learn what it shows and where the data come from. Your choices are remembered.',
  },
  { label: 'What if', text: 'switch physics on or off and compare.' },
  {
    label: 'Air slices',
    text: 'open Tools, then Air slices, for a side view of the air along a line. Tap “Set start (A)”, slide the map until the cross is over the spot and tap “Place A here”, then do the same for the end (B). Or open Presets and tap “Along the wind”, “Across the wind”, “Up the slope” or “Me to fire”. Tap or drag on the picture to read the air at that point, and use the chips to colour it by Speed, Along, Up/down, Across, Temp or Smoke. It works on every run: on the fast model it shows the diagnosed wind, and Temp and Smoke wait for the 3-D atmosphere. Back drops a line you are placing first, then closes the tool. It only reads the air and never changes the fire.',
  },
  { label: 'Where am I', text: '“Why here?” also names the nearest road and fire trail, how many homes are close and what the ground is like.' },
  { label: 'Data', text: 'the line at the bottom of the map credits the data you see; tap it (or open the menu) for the size, source and date of every data set.' },
  { label: 'How it works', text: 'the menu also has “How this simulation works”: what is 2-D and what is 3-D, how fine the grids are and how often they are updated.' },
  {
    label: 'Statistics',
    text: 'the menu has “Simulation debug statistics”, directly under Settings: how fast the simulation computes on this phone, where the time goes, memory and what this phone can do. “Copy as text” copies the page to paste into a message. Nothing is sent anywhere.',
  },
  {
    label: 'Settings',
    text: 'open it from the menu. Performance and Picture quality set how much the phone computes and how much the 3-D picture draws; both apply to the next model you build.',
  },
  { label: 'Back', text: 'the Back button closes the open menu, panel or screen first; the simulation keeps running while you read.' },
];

export interface GlossaryEntry {
  term: string;
  short?: string;
  body: string;
  /** A short list under the body, one line per name (the words of the map icons). */
  items?: readonly { name: string; text: string }[];
}

export const GLOSSARY: GlossaryEntry[] = [
  {
    term: 'ROS',
    short: 'Rate of spread',
    body: 'How fast the fire edge moves, usually in km/h or m/h. The head (front) is fastest, the flanks slower, the back slowest. Walking uphill on a 20° track is only about 1.4 km/h, so you cannot outrun a fire uphill.',
  },
  {
    term: 'FFDI',
    short: 'McArthur Forest Fire Danger Index',
    body: 'A number from temperature, humidity, wind and drought (drought factor 0–10). About 12 = moderate, 24 = high, 50 = extreme, 100 = catastrophic. It assumes flat ground, so slopes can make the same weather far worse.',
  },
  {
    term: 'Fire Danger Rating (AFDRS)',
    body: 'The public rating since 2022: Moderate, High, Extreme, Catastrophic. It is calculated for broad districts and fuel types, not for your slope or gully.',
  },
  {
    term: 'Dead fine fuel moisture',
    short: 'Litter moisture',
    body: 'Water content of dead leaves, twigs and bark thinner than 6 mm, as % of dry weight. It follows the air within an hour. Below about 6 % embers catch easily; above about 20 % fire struggles.',
  },
  {
    term: 'Slope effect',
    body: 'Uphill, flames lean onto the fuel ahead and pre-heat it, so the fire roughly doubles its speed every 10° of slope. Downhill it slows, but not below about half its flat-ground speed.',
  },
  {
    term: 'Flame attachment / eruptive fire',
    body: 'On slopes steeper than about 24°, and in gullies and chimneys, the flames can lie down along the ground and the fire can accelerate suddenly without any change in the weather. Classic cause of burnovers.',
  },
  {
    term: 'VLS',
    short: 'Vorticity-driven lateral spread',
    body: 'Strong wind over a steep lee slope creates a spinning eddy. Fire caught in it runs sideways along the slope, across the wind, and throws embers far downwind. Seen in the 2003 Canberra fires.',
  },
  {
    term: 'Anabatic wind',
    body: 'Upslope and up-valley breeze on sunny days, driven by sun-heated slopes. It adds to the uphill push on a fire from late morning.',
  },
  {
    term: 'Katabatic wind',
    body: 'Downslope and down-valley drainage of cold air at night and in shade. Fires back down gullies, and smoke sinks and pools in valleys.',
  },
  {
    term: 'Inversion',
    body: 'A layer where temperature increases with height, usually overnight. It traps smoke and holds fire activity down until the morning sun breaks it. Then winds from above can reach the fire within minutes.',
  },
  {
    term: 'Thermal belt',
    body: 'A band on the middle of mountain slopes that stays warmer and drier at night, above the cold air pooled in the valley. Fire keeps burning there when the valley floor goes quiet.',
  },
  {
    term: 'Wind change',
    body: 'A sudden swing in wind direction, typically a SW change after hot NW winds. The long flank of the fire becomes a wide head fire. A wind change was the main factor in many Australian firefighter entrapments.',
  },
  {
    term: 'Dead man zone',
    body: 'The ground next to the fire that would burn within about 5 minutes after a wind change (Cheney et al. 2001). It can be under 100 m or well over 1 km wide. Get into the black or a refuge before the change.',
  },
  {
    term: 'Spotting',
    body: 'Burning bark and leaves (embers) carried ahead of the fire start new spot fires. Stringybark is the worst source. Spot fires below the main fire run uphill to meet it.',
  },
  {
    term: 'Junction zone',
    body: 'Where two fire edges meet at a narrow angle (e.g. a back burn and the main fire). The meeting point can move several times faster than either fire. Stay out of the “V”.',
  },
  {
    term: 'Byram convective number',
    body: 'Compares the fire’s heat with the wind’s power. Below about 2 the wind drives the fire; above about 10 the fire’s own plume dominates and near-fire winds stop following the forecast.',
  },
  {
    term: 'PyroCb',
    short: 'Pyrocumulonimbus',
    body: 'A thunderstorm made by the fire’s own plume. It brings erratic strong winds, lightning and long-range spotting. Watch for a capped, towering column and sudden calm.',
  },
  {
    term: 'Back burn',
    body: 'Fire lit deliberately from a control line to remove fuel ahead of the main fire. Needs the right weather, an anchor and a plan for the wind change; can create junction zones.',
  },
  {
    term: 'LACES',
    body: 'Lookouts, Awareness, Communications, Escape routes, Safety refuges: the Australian fireground safety system. A refuge needs clearance of at least 4× the flame height, and more on slopes or in wind.',
  },
  {
    term: 'Intensity',
    short: 'Byram fireline intensity (kW/m)',
    body: 'Energy released per metre of fire edge. Under about 500 kW/m hand tools can hold it; above about 4,000 kW/m only indirect attack; above 10,000 kW/m crown fire is likely.',
  },
  {
    term: 'Fuel hazard',
    body: 'Scores (low → extreme) for surface litter, near-surface grass and low shrubs, elevated shrubs and bark (Overall Fuel Hazard Assessment Guide). They drive spread rate and flame height in the Vesta model.',
  },
  {
    term: 'Time since fire',
    body: 'Fuel re-accumulates over about 10–20 years after a fire or hazard-reduction burn. Recently burnt ground slows a fire and is a better anchor, but only for a few years.',
  },
  {
    term: 'Layer',
    short: 'One kind of information on the map',
    body: 'Roads, fire trails, homes, residential areas, place names, trees, shrubs, wind streaks, flames, smoke or a heat map. Each one switches on or off on its own in the Layers panel, and its (i) button says what it shows, why it matters and where the data come from.',
  },
  {
    term: 'Heat map',
    short: 'The ground coloured by one measurement',
    body: 'Cool colours (blue, green) mean little and warm colours (orange, red) mean a lot, for example of slope, fuel hazard or how fast the fire runs. One heat map shows at a time; “Show on its own” hides the photo and the trees so the colours are easy to read.',
  },
  {
    term: 'Night lighting',
    short: 'How the map is lit after dark',
    body: 'In Layers, under Map type. Realistic follows the clock: the ground goes dark at night, as it would, and a fire’s glow stands out. Brighter and Daylight light the ground, trees and roads after dark from a fixed sun in the north-west, so slopes, ridges and roads stay easy to read; Daylight is the brightest. They fade in around sunset, and by day nothing changes. The sky, the stars and the fire’s glow still follow the clock. It only changes how the map is drawn, never the fire. It applies at once, is remembered for next time, and “Reset layers” puts it back to Realistic.',
  },
  {
    term: 'Map icons',
    short: 'What the icons on the map mean',
    body: 'Tap an icon with the Why here? tool (the one the map uses while no other tool is open) and the panel starts with a row that shows the icon as drawn on the map, its name and a line of detail. Tap the ground beside it and there is no such row, so you can tell what your tap took. A tap within about 22 px of an icon’s centre counts. When icons overlap, the nearest one wins and the row says how many more are there: zoom in to tell them apart.',
    items: [
      { name: 'You are here', text: 'A blue dot with a white ring: your phone’s position. It is not drawn at eye level.' },
      { name: 'Ignition point, line or area', text: 'A red pin with a flame: a fire or a back-burn you marked, and the time it was lit. For a line or an area the pin is at its first point.' },
      { name: 'Spot fire', text: 'An orange disc with a flame: a fire started by an ember, with when it started and how far ahead of the front it is, or a spot fire you marked.' },
      { name: 'Danger', text: 'A red octagon with an exclamation mark: the most serious kind of insight card. The row gives the kind, for example Danger: Uphill run, and the card’s title.' },
      { name: 'Watch out', text: 'An amber triangle with an exclamation mark: an insight card that asks for attention. The row gives the kind and the card’s title.' },
      { name: 'Insight', text: 'A blue circle with an i: an insight card that explains something the fire is doing. The row gives the kind and the card’s title. The Insight markers layer draws all three.' },
      { name: 'Home', text: 'A small house, or a dot when far away: one marker per address. A home can be tapped only while the Homes layer is on, and not when a hill hides it.' },
    ],
  },
  {
    term: 'Data set',
    short: 'One source the model is built from',
    body: 'For example the ground height, the vegetation map or the weather forecast. The Data sets screen (main menu) lists each one with its size, who provides it, how fine it is, how old it is and where it came from.',
  },
  {
    term: 'Bundled, live, saved, estimated',
    short: 'Where a data set came from',
    body: 'Bundled data ship inside the app, so they work with no signal. Live data were downloaded while the model was built. Saved data are a copy the phone kept from an earlier download. Estimated data were worked out or made up by the app because the real ones were not available.',
  },
  {
    term: 'Resolution',
    short: 'How fine the data are',
    body: 'A 30 m grid keeps one value for every 30 m by 30 m square. Finer data show smaller gullies and ridges, but take more time and memory.',
  },
  {
    term: '2-D and 3-D',
    short: 'What the model works out in each',
    body: 'The fire spreads in 2-D, along the ground. Embers are tracked in 3-D. The air above is stepped through time in 3-D on the standard and high settings. The fast one has no time-stepped air: it fits the forecast wind to the terrain (the diagnosed wind) and the fire feels a 2-D surface wind built from it, so the fire comes out a little different. Auto, the usual choice, uses the 3-D air unless a short timing test when the run starts finds this phone far too slow for it. “How this simulation works” in the main menu shows what your run is using and why.',
  },
  {
    term: 'Picture quality',
    short: 'How much the 3-D picture draws',
    body: 'In Settings, under Simulation: Auto, Low, Medium or High. A higher choice draws more terrain, trees and rock detail on cliffs, and needs more memory. Auto picks from this phone’s cores and memory, and picks High when Performance is set to Detail. The picture still lowers its own resolution if the frame rate stays under 30. If High is chosen on a phone that looks like a Low device, a line under the choice warns that it may run slowly or close the app. It applies to the next model you build, and it never changes the fire. The Simulation debug statistics say which one is in use and why.',
  },
  {
    term: 'Cliffs and rock',
    short: 'How cliff faces are drawn',
    body: 'In the 3-D view, cliff faces are drawn steeper than the data and show ledges, joints, stains and scree. The simulation, the slope overlay and every number use the data as received. The ground height data shows a cliff as a steep slope rather than a sheer wall, so the view steepens very steep ground into a rock wall, lights it from that ground and adds ledges that catch the light, vertical joints, dark bands under overhangs, water stains, loose scree below a face and bare rock along the top. Trees are left off bare faces. It is always on, and there is no setting to turn it off. How much rock detail is drawn follows Picture quality: High draws all six kinds, Medium four and Low three. A face under about 60 m high still reads as a steep bank, because the picture is too coarse to show it as a wall. It only changes how the ground is drawn, never the fire.',
  },
  {
    term: 'Why is it slow?',
    short: 'The gauge button at the end of the timeline',
    body: 'When you play faster than this phone can compute, playback has to wait for the simulation. A small gauge button then appears at the right end of the timeline, with a faint outline while the simulation is falling behind and a thicker ring once playback is waiting. It never opens by itself: tap it to see what you asked for, what this phone is computing, where the time goes and what you can do, such as playing at a slower speed or switching to the fast model (the fire is computed again from the last checkpoint, up to half an hour of fire ago, and comes out a little different). It never changes the result: the same choices give the same fire at any speed, it only takes longer to appear. Playing slower is what helps. Pausing stops the simulation too. There is no button at Max speed, because Max asks for no particular speed. “All the numbers” on the sheet opens the Simulation debug statistics.',
  },
  {
    term: 'Simulation debug statistics',
    short: 'Speed, memory and what this phone can do',
    body: 'A page of measurements for anyone who wants to see how the simulation is doing on this phone: how fast it computes and how that changed, where the time goes, memory, the picture’s frame rate and what this phone can do. Open the main menu and tap Simulation debug statistics, directly under Settings (it is also in Settings, under Data and transparency, and in Setup, where the phone facts work before any run). Tap “Copy as text” to copy the whole page, ready to paste into a message. Nothing is sent anywhere: the copy has no coordinates and no identifiers, and a place you chose yourself is only called a custom place. The numbers are measured on this phone and update every second while the page is open. Where a phone’s browser hides its model or Android version, the page says “Hidden by the WebView” instead of guessing.',
  },
  {
    term: 'Air slices',
    short: 'A side view of the air along a line',
    body: 'In Tools. It cuts the air along a line you choose and shows it from the side, with height up the picture and distance along the line from A on the left to B on the right. Set A and B with the cross, or open Presets: “Along the wind”, “Across the wind”, “Up the slope” (A downhill, B uphill) or “Me to fire”, which needs your position inside the model area. A preset is a line through the fire, or through the middle of the map when there is no fire yet, about 3 km each way, and it follows the wind and the fire while the run plays. Placing a line also switches on the same slice in the 3-D view, as a curtain standing over the map; Layers can switch it off. The chips colour the slice by Speed, Along, Up/down, Across, Temp or Smoke. The four wind chips work on every run, and Temp and Smoke need the 3-D atmosphere. It only reads the air, so it never changes the fire.',
  },
  {
    term: 'Side view',
    short: 'The air along a line, seen from the side',
    body: 'The picture in the Air slices panel. A is always at the left and B at the right. Heights are metres above sea level, drawn at true scale times the Vertical exaggeration set in Layers; a tag on the height axis says “True scale” or, for example, “Height ×1.5”, and if the picture has to be squeezed to fit, it says the scale really drawn. The filled ground is the 10 m terrain data. The dashed line is the ground as the model itself sees it, which is smoother, so cliffs it smooths away show only in the filled ground. Streaks drift with the air in the plane of the slice, so the flow over a ridge and any rising or sinking air can be seen moving; if the phone is set to reduce motion, still arrows are drawn instead. The picture follows playback. Its footer says what kind of air it shows, how fine the model grid is and when the air is from.',
  },
  {
    term: 'Diagnosed wind',
    short: 'The fast model’s wind, fitted to the terrain',
    body: 'What the fast model has in place of time-stepped 3-D air. It takes the forecast wind and fits it to the terrain, the way hills bend, funnel and slow it, once for each weather record and blended in time between two of them. So it shows terrain effects only: no fire plume, no cold air draining down the valleys, no sun-driven slope winds, no temperature and no smoke, and at night or in a valley the wind near the ground can be quite different. The Air slices tool and the wind speed map work with it and say so: the footer reads “Diagnosed wind: terrain effects only”. The 3-D atmosphere adds the rest. “Use the 3-D atmosphere”, in Layers or in Air slices, switches a run over; it is computed again from the last checkpoint, up to half an hour of fire ago.',
  },
  {
    term: 'Air from',
    short: 'How old the air in a slice is',
    body: 'The footer of the side view says when the air it shows was made, for example “air from 11:25”. That is the simulation’s own clock, the one on the screen, not the time of day on your phone. The air is saved about every 5 minutes, so the picture you are looking at is put together from the nearest saved air at or before its time, and the air can be up to about 5 minutes older than the fire you see, while the run plays as well as when you jump back. Only the newest picture of the run has air made at its own time. Past 90 seconds the footer says how much older, for example “air from 11:25 (4 min before the time shown)”.',
  },
  {
    term: 'Model cells',
    short: 'The blocks the air model really uses',
    body: 'The air model keeps one value for each block of a grid (the footer gives the width of a block) and for each layer above the ground. The side view normally draws the air smoothed between them, which looks finer than the model is. Turn on “Show model cells” to draw one block for each cell the line passes through, with the model’s own value in it and nothing blended. What happens inside a block is not known to the model.',
  },
  {
    term: 'Probe',
    short: 'Reading the air at one point',
    body: 'Tap or drag on the side view and a line of words says what the air is doing at that point, for example “Wind about 32 km/h from the north-west, along the line 28 km/h towards B, up 1.4 m/s, 60 m above ground, 3 K warmer than average”. A pin on the map shows where along the line the point is. K is a kelvin: a difference of 3 K is a difference of 3 degrees Celsius. “Average” means the average of the slice at that height: the model’s air along the line that lies at about the same height above sea level. With the picture selected, the arrow keys move the probe and Escape clears it, and so does the small X button beside the words. Points inside the ground, below the model’s own ground or above its top get a short sentence that says so instead. The temperature part is only there on the 3-D atmosphere.',
  },
  {
    term: 'Along and across',
    short: 'Two ways to split the wind in a slice',
    body: 'The Along and Across chips split the sideways wind into the part that runs with the line and the part that crosses it. Along is positive towards B and negative towards A. Across is positive towards the right of someone walking from A to B and negative towards the left. Both use one pair of colours, purple towards A or the left and green towards B or the right, with a pale middle where there is no wind in that direction. Up/down is the third part: air rising (warm colours) or sinking (cool colours), in metres per second. Speed is the sideways wind speed whichever way it blows, and does not count air going up or down. The wind is always named by where it comes from.',
  },
  {
    term: 'Wind speed map',
    short: 'The ground coloured by wind speed',
    body: 'A heat map in Layers, under Fire and weather: the wind 10 m above the ground, place by place, in km/h, as the air model gives it. It works on the 3-D atmosphere and on the fast model too. On the fast model it shows the diagnosed wind, the forecast wind fitted to the terrain, without the night-time, slope-wind and fire effects that the fast model adds for the fire itself. It is not always the wind the fire feels. On a windy day or night the two agree closely, but on a calm night they can differ a lot, on both the fast model and the 3-D atmosphere: in places the fire feels much less wind than the map shows, and in others much more. Like the other fire and weather maps it needs a fire marked first.',
  },
  {
    term: 'Canopy height',
    short: 'How tall the trees are',
    body: 'Estimated from satellite pictures (Meta and the World Resources Institute), so the trees in the 3-D view stand at about their real height. Tall trees with loose bark can throw embers a long way.',
  },
  {
    term: 'Understorey',
    short: 'The shrubs under the trees',
    body: 'The shrub layer is the ladder that lets flames climb from the ground into the tree crowns. More and taller shrubs mean a higher fire hazard.',
  },
  {
    term: 'Bark hazard',
    body: 'How much loose, stringy bark the trees carry. Smooth gums have little; stringybark has the most and is the worst source of embers.',
  },
  {
    term: 'Grass curing',
    body: 'How dry and golden the grass is, from fresh and green to fully dry. Dry grass burns fast and fierce; green grass hardly burns.',
  },
  {
    term: 'Fire trail',
    body: 'A vehicle track that the NSW Rural Fire Service has classified for firefighting access. Shown separately from ordinary roads.',
  },
];

/**
 * One credit line of Settings → Data and licences. The list names exactly the data the app uses (checked against the
 * data-set records, src/scenario/datasetAttribution.test.ts), and the feeds it can read but does not use yet are marked
 * so nothing is over-claimed.
 */
export interface Attribution {
  name: string;
  use: string;
  licence: string;
  /** Who publishes it. */
  provider?: string;
  /** The credit line the data carry (the same text as the data-set records' `attribution`). */
  attribution?: string;
  /** 'used' (every scenario that needs it), 'fallback' (only when the first choice is missing), 'not-used' (the app can read it but does not use it yet). */
  status?: 'used' | 'fallback' | 'not-used';
}

export const ATTRIBUTIONS: Attribution[] = [
  {
    name: 'NSW Spatial Services (elevation)',
    provider: 'NSW Spatial Services, Department of Customer Service',
    use: 'Ground height for the demo sites: the NSW 5 m elevation model (NSW_5M_Elevation, which the service says is derived from stereo imagery), bundled at 10 m',
    licence: '© Spatial Services NSW, CC BY 4.0',
    attribution: RECORD_ATTRIBUTION.spatial,
    status: 'used',
  },
  {
    name: 'NSW Spatial Services (aerial imagery)',
    provider: 'NSW Spatial Services, Department of Customer Service',
    use: 'Aerial photos of the demo sites (NSW_Imagery, a mosaic of flights from several years), display only',
    licence: 'CC BY 4.0',
    attribution: RECORD_ATTRIBUTION.imagery,
    status: 'used',
  },
  {
    name: 'SRTM / AWS Terrain Tiles (Mapzen Terrarium)',
    provider: 'NASA / U.S. Geological Survey SRTM, tiles by Mapzen on AWS Open Data',
    use: 'Ground height (about 30 m) outside the demo sites',
    licence: 'Public domain (NASA/USGS SRTM); tiles via AWS Open Data',
    attribution: RECORD_ATTRIBUTION.terrarium,
    status: 'fallback',
  },
  {
    name: 'Meta & World Resources Institute',
    provider: 'Meta and World Resources Institute (WRI)',
    use: 'Tree canopy height and cover (High Resolution Canopy Height Maps v1, Tolan et al. 2024)',
    licence: 'CC BY 4.0',
    attribution: RECORD_ATTRIBUTION.meta,
    status: 'used',
  },
  {
    name: 'NSW State Vegetation Type Map (SVTM)',
    provider: 'NSW Department of Climate Change, Energy, the Environment and Water (DCCEEW)',
    use: 'Vegetation formations and classes → fuel types',
    licence: '© State of NSW and DCCEEW, CC BY 4.0',
    attribution: RECORD_ATTRIBUTION.svtm,
    status: 'used',
  },
  {
    name: 'NSW National Parks and Wildlife Service',
    provider: 'NSW National Parks and Wildlife Service (DCCEEW)',
    use: 'Fire history (wildfires and prescribed burns)',
    licence: '© State of NSW and DCCEEW, CC BY 4.0',
    attribution: RECORD_ATTRIBUTION.npws,
    status: 'used',
  },
  { name: 'NSW Spatial Services (roads and fire trails)', provider: 'NSW Spatial Services', use: 'Roads and tracks (Transport Theme) and RFS-classified fire trails for the Roads layer', licence: '© Spatial Services NSW, CC BY 4.0', attribution: '© Spatial Services NSW', status: 'used' },
  { name: 'NSW Spatial Services (addresses)', provider: 'NSW Spatial Services', use: 'Home address points (Geocoded Addressing Theme) for the Homes layer', licence: '© Spatial Services NSW, CC BY 4.0', attribution: '© Spatial Services NSW', status: 'used' },
  { name: 'NSW Spatial Services (place names)', provider: 'NSW Spatial Services', use: 'Place and suburb names (Features of Interest, Administrative Boundaries) to help you find your way', licence: '© Spatial Services NSW, CC BY 4.0', attribution: '© Spatial Services NSW', status: 'used' },
  {
    name: 'NSW Planning (land zoning)',
    provider: 'NSW Department of Planning, Housing and Infrastructure',
    use: 'Residential, village and other built-up land-use zones (ePlanning Land Zoning Map)',
    licence: '© State of NSW and Department of Planning, Housing and Infrastructure, CC BY 4.0',
    attribution: '© State of NSW and Department of Planning, Housing and Infrastructure',
    status: 'used',
  },
  {
    name: 'Open-Meteo',
    provider: 'Open-Meteo.com',
    // Open-Meteo's documentation (read 2026-09-30) says only that 'best match' gives "the best forecast for any given
    // location"; it does not say which models that combines for Australia, and it reports the Bureau of Meteorology's
    // ACCESS-G open data as temporarily suspended. So no model is named that the app cannot verify.
    use: "Weather: forecasts from Open-Meteo's automatic 'best match' (the model it judges best for the location; the answer does not say which), past weather, the year of daily rain behind the drought index, and the historic fire days",
    licence: 'CC BY 4.0 (free for non-commercial use, which includes education)',
    attribution: RECORD_ATTRIBUTION.openMeteo,
    status: 'used',
  },
  {
    name: 'ECMWF IFS (through Open-Meteo)',
    provider: 'European Centre for Medium-Range Weather Forecasts',
    use: "Forecast when 'best match' fails, upper-air levels (IFS 0.25°), the 2019/20 historic fire days (historical forecasts), and, from 2017, part of the archive's default 'best match' behind the year of daily rain (IFS HRES analysis, 9 km)",
    licence: 'CC BY 4.0 (ECMWF open data)',
    status: 'used',
  },
  {
    name: 'NOAA GFS (through Open-Meteo)',
    provider: 'U.S. National Oceanic and Atmospheric Administration',
    use: 'Upper-air levels only when the ECMWF levels are missing',
    licence: 'Public domain (U.S. Government work)',
    status: 'fallback',
  },
  {
    name: 'Copernicus ERA5 (through Open-Meteo)',
    provider: 'Copernicus Climate Change Service / ECMWF',
    use: "Past weather before 2016 (and later dates when the historical forecast is missing) and the 2013 historic fire days; with ERA5-Land and the ECMWF IFS analysis, part of the archive's default 'best match' behind the year of daily rain and temperature for the drought index and the usual yearly rainfall",
    licence: 'CC BY 4.0 through Open-Meteo; contains modified Copernicus Climate Change Service information',
    status: 'used',
  },
  {
    name: 'NSW Rural Fire Service (incidents feed)',
    provider: 'NSW Rural Fire Service',
    use: 'Not used yet: the app can read the current-incidents and fire-danger feeds but does not show them',
    licence: '© NSW RFS, information only',
    status: 'not-used',
  },
  {
    name: 'Geoscience Australia DEA Hotspots',
    provider: 'Geoscience Australia (Digital Earth Australia)',
    use: 'Not used yet: the app can read satellite fire hotspots but does not show them',
    licence: 'CC BY 4.0',
    status: 'not-used',
  },
];

export const REFERENCES: { file: string; title: string }[] = [
  { file: '01-terrain-fire-behaviour.md', title: 'Terrain and fire behaviour' },
  { file: '02-mountain-meteorology.md', title: 'Mountain meteorology' },
  { file: '03-australian-fire-models.md', title: 'Australian fire behaviour models' },
  { file: '04-fuel-moisture.md', title: 'Fuel moisture' },
  { file: '05-fuel-accumulation-history.md', title: 'Fuel accumulation and fire history' },
  { file: '06-embers-spotting.md', title: 'Embers and spotting' },
  { file: '07-fire-atmosphere-coupling.md', title: 'Fire–atmosphere coupling' },
  { file: '08-data-sources-apis.md', title: 'Data sources and APIs' },
  { file: '09-mobile-tech-stack.md', title: 'Mobile technology and field UX' },
  { file: '10-firefighter-education.md', title: 'Firefighter education and safety content' },
];
