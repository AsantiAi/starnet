---
name: maps
description: "Location answers from free OpenStreetMap services, no API key: geocode places, reverse-geocode coordinates, find nearby places by category, road distance and directions, timezones, and area bounds."
license: MIT
metadata:
  title: "Maps"
  category: "Productivity"
  author: "Mibayy"
---

# Maps

Location intelligence from free, open data services, called directly with `web_request`. No API key, no install, no scripts.

Services: Nominatim (OpenStreetMap geocoding), the Overpass API (OpenStreetMap place search), OSRM routing on the FOSSGIS servers, and TimeAPI.io.

## When to use

- The Commander shares coordinates or a location pin (latitude/longitude in a message, for example from a connected chat channel) and asks what is nearby → **nearby**
- Coordinates for a place name → **search**
- An address for coordinates → **reverse**
- Nearby restaurants, pharmacies, hospitals, hotels, and similar → **nearby**
- Driving, walking, or cycling distance or travel time → **distance**
- Turn-by-turn directions → **directions**
- The timezone of a location → **timezone**
- Places inside a named area → **area**, then **bbox**

## Rules for every call

- **Use `web_request`** (GET unless stated). Each call can ask the Commander for approval, so plan the fewest calls that answer the question.
- **Identify yourself.** Always send the header `"User-Agent": "StarNet maps skill"`. The OpenStreetMap services refuse or throttle anonymous browser-like clients.
- **Rate limits:** at most 1 request per second to Nominatim and to the routing server, no bulk geocoding, no scraping. Reuse results you already have in this conversation instead of asking again.
- **URL-encode** every value you put in a query string (spaces, commas, quotes, brackets, semicolons, newlines).
- **Response window:** `web_request` returns about 8,000 characters of body. Keep `limit` small (3-5 for geocoding, about 10 for places) and use the compact CSV output for place lists.
- **Attribution:** end location answers with "Data © OpenStreetMap contributors (ODbL)".
- **Order:** Nominatim and Overpass use latitude, longitude. OSRM URLs use **longitude,latitude**. Getting this backwards is the most common error.

## search: geocode a place name

GET `https://nominatim.openstreetmap.org/search?q=<place, URL-encoded>&format=jsonv2&limit=3&addressdetails=1`

Each result gives `lat`, `lon` (strings), `display_name`, `category`/`type`, `importance`, `address` parts, and `boundingbox` as `[south, north, west, east]`. Take the first result unless the name is ambiguous; if the top results are in different places, show them and ask. For a bare postcode, add the country or state to the query.

## reverse: coordinates to address

GET `https://nominatim.openstreetmap.org/reverse?lat=<lat>&lon=<lon>&format=jsonv2&addressdetails=1`

Gives `display_name` and an `address` breakdown (road, house number, city, state, postcode, country).

## nearby: find places by category

1. Get the center: coordinates from the Commander, or **search** for the place they named ("cafes near Times Square").
2. Map each requested category to its OpenStreetMap tag (table below).
3. Build an Overpass query. Default radius 500 m, default limit 10:

```
[out:csv(::type,::id,name,::lat,::lon,"addr:housenumber","addr:street","addr:city",cuisine,opening_hours,phone,website;true;"|")][timeout:25];
(
  node["amenity"="cafe"](around:500,<lat>,<lon>);
  way["amenity"="cafe"](around:500,<lat>,<lon>);
);
out center 10;
```

4. Send it as GET `https://overpass-api.de/api/interpreter?data=<the whole query, URL-encoded>`. For a long query, POST to the same URL with header `"Content-Type": "application/x-www-form-urlencoded"` and body `data=<the URL-encoded query>`.
5. The answer is one header row plus one `|`-separated row per place (`@type|@id|name|@lat|@lon|...`). `out center` gives ways (buildings, areas) a center point too.

For several categories, add more `node`/`way` pairs inside the same parentheses, one pair per tag. For a category tagged two ways (bakery), include both tags. Places of worship add a religion filter: `node["amenity"="place_of_worship"]["religion"="christian"](around:...)`.

If Overpass answers with an error page saying the server is too busy, wait a few seconds and retry once. If it fails again, tell the Commander the public server is overloaded.

**Distance and sorting.** Compute each place's distance from the center and sort by it. For short distances, the flat approximation is accurate enough: dy = Δlat × 111,320 m, dx = Δlon × 111,320 × cos(center latitude) m, distance = √(dx² + dy²).

**Presenting results.** A numbered list: name, distance, address when present, and the useful extras (cuisine, opening hours, phone, website). Skip unnamed rows unless nothing else was found. Give each place a tap-to-open map link: `https://www.openstreetmap.org/?mlat=<lat>&mlon=<lon>#map=18/<lat>/<lon>` (a `geo:<lat>,<lon>` link opens the default map app on phones). Opening hours in OpenStreetMap are community-maintained; for "is it open now?", check the `opening_hours` value and confirm with `web_search` when it matters.

### Category → OpenStreetMap tag

| Category | Tag |
|---|---|
| restaurant, cafe, bar, nightclub | `amenity` = restaurant, cafe, bar, nightclub |
| bakery | `shop=bakery` and `amenity=bakery` (search both) |
| convenience_store, supermarket, bookshop, laundry | `shop` = convenience, supermarket, books, laundry |
| hospital, pharmacy, dentist, doctor, veterinary | `amenity` = hospital, pharmacy, dentist, doctors, veterinary |
| hotel, guest_house, camp_site, museum, zoo | `tourism` = hotel, guest_house, camp_site, museum, zoo |
| atm, bank | `amenity` = atm, bank |
| gas_station, parking, taxi, car_wash, car_rental, bicycle_rental | `amenity` = fuel, parking, taxi, car_wash, car_rental, bicycle_rental |
| airport | `aeroway=aerodrome` |
| train_station | `railway=station` |
| bus_stop | `highway=bus_stop` |
| cinema, theatre | `amenity` = cinema, theatre |
| school, university, library | `amenity` = school, university, library |
| police, fire_station, post_office | `amenity` = police, fire_station, post_office |
| church, mosque, synagogue | `amenity=place_of_worship` + `religion` = christian, muslim, jewish |
| park, gym, swimming_pool, playground, stadium | `leisure` = park, fitness_centre, swimming_pool, playground, stadium |

For anything not listed, look up the right tag on the OpenStreetMap wiki with `web_search` before querying.

## distance: travel distance and time

1. **search** the origin and the destination (one request per second).
2. GET `https://routing.openstreetmap.de/<profile>/route/v1/driving/<lon1>,<lat1>;<lon2>,<lat2>?overview=false&steps=false`, with `<profile>` = `routed-car` (driving, the default), `routed-foot` (walking), or `routed-bike` (cycling). The `driving` segment stays the same for every profile; the profile picks the network.
3. Check `code` is `Ok`. Read `routes[0].distance` (meters) and `routes[0].duration` (seconds).
4. Report distance in km, duration in hours and minutes, and the straight-line distance for comparison (the flat approximation above, or the haversine formula for long distances).

Use the FOSSGIS profiles above for walking and cycling. The public OSRM demo server (router.project-osrm.org) returns car routes whatever profile you ask for, which silently gives wrong walking and cycling times.

## directions: turn-by-turn

Same request as **distance**, with `steps=true`. The steps sit in `routes[0].legs[].steps[]`; each has `maneuver.type` (depart, turn, new name, merge, fork, roundabout, end of road, continue, on ramp, off ramp, arrive), `maneuver.modifier` (left, right, slight left, straight, ...), `name` (the road), `distance`, and `duration`. Write each one as a plain instruction: "Turn left onto Rue de Rivoli (350 m)".

Step lists are large: a 4 km walk is about 30,000 characters, far past the `web_request` window. So:
- For a short trip (under about 1 km), `web_request` with `steps=true` works.
- For a longer trip, report the totals from **distance** and give the Commander a directions link that opens the full route: `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=<lat1>%2C<lon1>%3B<lat2>%2C<lon2>` (`fossgis_osrm_foot` for walking, `fossgis_osrm_bike` for cycling). Note that this link uses latitude,longitude.
- If the WORKBENCH is placed and the Commander wants the steps in chat, save the response with `shell.exec` (`curl -s -A "StarNet maps skill" -o route.json "<the routing URL>"`) and page through it with `fs.read`.

## timezone: timezone for coordinates

GET `https://timeapi.io/api/timezone/coordinate?latitude=<lat>&longitude=<lon>`

Gives `timeZone` (for example `Asia/Tokyo`), `currentLocalTime`, and `currentUtcOffset.seconds`. Convert the seconds to an offset (32400 → UTC+09:00). If the service is down, give the rough offset `round(longitude / 15)` hours and say plainly that it is an approximation that ignores political borders and daylight saving.

## area: bounding box of a named place

**search** the place and read `boundingbox` = `[south, north, west, east]`. Height ≈ (north − south) × 111.32 km; width ≈ (east − west) × 111.32 × cos(middle latitude) km; area ≈ height × width. Use it as the input for **bbox**.

## bbox: places inside a bounding box

The same Overpass query as **nearby**, with the box filter `(south,west,north,east)` instead of `(around:...)`:

```
[out:csv(::type,::id,name,::lat,::lon,"addr:street",opening_hours;true;"|")][timeout:25];
(
  node["amenity"="restaurant"](40.75,-74.00,40.77,-73.98);
  way["amenity"="restaurant"](40.75,-74.00,40.77,-73.98);
);
out center 20;
```

Put the smaller latitude and longitude first. Sort by distance from the box center when the Commander wants the most central places.

## Workflow examples

- **"Find Italian restaurants near the Colosseum":** search "Colosseum, Rome" → nearby restaurant, radius 500, then filter rows whose cuisine is `italian`.
- **"What is near this pin?":** take the latitude and longitude from the message → nearby cafe (or what was asked), radius 1500.
- **"How do I walk from my hotel to the conference center?":** search both → distance with `routed-foot` → steps if short, otherwise the directions link.
- **"What restaurants are in downtown Seattle?":** area "Downtown Seattle" → bbox restaurant, limit 30.

## Pitfalls

- Longitude/latitude order: OSRM URLs are `lon,lat`; everything else here is `lat,lon`.
- Nominatim allows 1 request per second and needs the identifying User-Agent.
- `nearby` needs a center: coordinates or a place to geocode first.
- OSRM routing coverage is best in Europe and North America.
- The Overpass API can be slow at peak hours; retry once, then report it.
- A bare postcode can match several countries; add the country or state.
- An empty CSV (header row only) means no mapped places of that type within the radius; widen the radius once before reporting "none".

## Verification

- search "Statue of Liberty" returns lat about 40.689, lon about -74.044.
- nearby restaurant around Times Square (radius 500) returns a list of named restaurants within about 500 m.

*Needs the DISH for `web_request`. The WORKBENCH is optional, for long turn-by-turn lists.*

Adapted for StarNet from maps (Mibayy), MIT.
