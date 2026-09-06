# Flash report account matching, 44 North

Written **2 Sep 2026**. Every pair below was ruled on by Nicholas, not inferred.

**The machine-readable copy is `44 North/ACCOUNT_MAP_44North.csv`.** Open that
in Sheets when you need to look an account up. This file is the reasoning.

## What this is

The distributor's monthly EOM flash reports ~342 Florida customers. Some are
iHospitality accounts and most are not, and the two systems name them
differently. This is the reconciliation.

`Invoicing/flash_match.py` is what actually runs. This document explains it.

## Why it is written down

Fuzzy matching cannot be trusted here. Left alone it proposed:

- **Universal Studios** for "University Wine and Spirit", carrying 58 FYTD cases
- Three separate Orlando bars collapsed onto one NONA SOCIAL
- **BIG B LIQUORS** for Big C Liquors, a different shop in a different city
- **DRIFTWOOD WINE & SPIRITS** in the panhandle for Hampton Wine & Spirits in Palm Beach

It also mis-scored a real account silently. Six flash names are shared by
several stores, and a name-keyed lookup kept whichever row came last, scoring
our **Port St Lucie** Maggie McFly off the **Boca Raton** store. `flash_match.py`
now raises on an ambiguous name instead of guessing.

**The customer number (`700xxxxxx`) is the only durable key.** Name plus city is
a guess. Capturing those numbers against venues is the real fix and is not done.

## What the reconciliation changed

July 2026 year-over-year moved every time an account was added:

| After | Jul 2026 | Jul 2025 | Change |
|---|---|---|---|
| 2026-active accounts only | 32 | 24 | +33.3% |
| including lapsed accounts | 35 | 31 | +12.9% |
| three renamed accounts found | 35 | 37 | -5.4% |
| Good Pour Gainesville | 35 | 38 | -7.9% |
| Jellyfish, Golden Ox, Breeze | 37 | 39 | -5.1% |
| reconciling every case sale in both masters | **38** | **41** | **-7.3%** |

It began as growth and ended as a decline. Florida was **-17.9%**, so the
accounts still beat the market by 10 points, but "we grew while Florida fell"
was never true and would have gone out three times.

## Two names for the same place

The masters and the portal name accounts differently, so both spellings are keys
here. `Phyre Saloon` in the portal is `Phyre Brewery & Tavern` in the master and
in the flash. Netting logic that compares raw strings will double count.

## Confirmed pairs

| Our account | Distributor customer | Cust # | City |
|---|---|---|---|
| 1881 Kissimmee | BREEZE 1881 RESTAURANT | 700137984 | Kissimmee |
| 24 Middleton | 24 MIDDLETON | 700434785 | Middleton |
| AC Sports Bar | AC SPORTS BAR | 700438222 | Orlando |
| Aku Aku | STARDUST LOUNGE | 700043137 | Orlando |
| Alfie's Liquors | ALFIES DISCOUNT LIQUORS | 700411044 | Keystone Heights |
| American Liquor | AMERICAN LIQUOR | 700078019 | Melbourne |
| Best Western | BEST WESTERN ORLANDO | 700399106 | Orlando |
| Big Daddy's | BIG DADDYS | 700105297 | Orlando |
| Big Jim's Famous Steak | BIG JIMS FAMOUS STEAKS | 700419470 | Largo |
| Blue on the Ave | BLU ON THE AVENUE | 700119070 | Winter Park |
| Bovine | BOVINE STEAKHOUSE LLC | 700279023 | Winter Park |
| Brass Tap | BRASS TAP THE | 700137081 | Boynton Beach |
| Breeze St Cloud | BREEZE EAST SIDE | 700286032 | St Cloud |
| Bronson Liquors 192 | BRONSON LIQUORS | 700099798 | Kissimmee |
| BTW Crafted | BTW BURGERS TACOS WAFF | 700257049 | Tavares |
| Chefs Table | CHEFS TABLE AT EDGEWATER | 700439525 | Winter Garden |
| Clermont Brewing Co. | CLERMONT BREWING COMPANY | 700255211 | Clermont |
| Copper Shaker St Pete | COPPER SHAKER THE ESTATE | 700118574 | St Petersburg |
| Copper Shaker Ybor | COPPER SHAKER | 700283602 | Tampa |
| Country Club of Orlando | COUNTRY CLUB OF ORLANDO | 700022533 | Orlando |
| County Line | COUNTY LINE BAR & GRILL | 700400583 | Melbourne |
| Dancers Royale | DANCERS ROYALE | 700022970 | Orlando |
| Debauchery | DEBAUCHERY | 700102026 | Melbourne |
| Devaneys Sport Pub | DEVANEYS SPORTS PUB | 700023221 | Winter Park |
| Driftwood | DRIFTWOOD | 700197294 | Boynton Beach |
| Ellie Mae's Tiki Bar | ELLIE MAES TIKI BAR | 700262933 | Cape Canaveral |
| Ember & Oak | EMBER AND OAK | 700241779 | Melbourne |
| Enigma | GREGS ENIGMA | 700128909 | St Petersburg |
| Florida Bottle and Cork | FL CORK & BOTTLE | 700353402 | Indian Harbour Beach |
| Florida Cork & Bottle | FL CORK & BOTTLE | 700353402 | Indian Harbour Beach |
| FM Pizza | FM PIZZA OVEN | 700259648 | Melbourne |
| Foo Bar | FOO BAR | 700335807 | Melbourne |
| Front Row (Franks Place) | FRANKS PLACE | 700023110 | Ocoee |
| Gaylord Palms | GAYLORD PALMS RESORT | 700024314 | Kissimmee |
| Golden Ox - Warehouse | GOLDEN OX @ ARGYLE | 700026921 | Jacksonville |
| Good Pour Liquors | GOOD POUR GAINESVILLE THE | 700026435 | Gainesville |
| Good Pour Longwood | GOOD POUR LONGWOOD | 700353754 | Longwood |
| Goombay's | GOOMBAYS BEACHSIDE LLC | 700020146 | Satellite Bch |
| Graffiti Pizza | GRAFFITI PIZZA OF DESTIN | 700417206 | Destin |
| Haya Hotel | HOTEL HAYA | 700282205 | Tampa |
| Hemingway's Tavern | HEMINGWAYS TAVERN | 700140262 | Melbourne |
| Heritage Liquors | HERITAGE LIQUORS | 700285257 | Pt St Lucie |
| Hideaway Bar | HIDEAWAY THE | 700073505 | Orlando |
| Hollerbach German | HOLLERBACHS | 700405764 | Sanford |
| Huck's Oyster Bar & Grill | HUCKS | 700435205 | Crystal River |
| Hurricane Alley | HURRICANE ALLEY | 700104865 | Boynton Beach |
| Hurricane Hanks | HURRICANE HANKS/HURRICAN OFF | 700283058 | Holmes Beach |
| Iron Oak Post | IRON OAK POST | 700156158 | Melbourne |
| Kiwi Tennis Club | KIWI TENNIS CLUB LLC | 700401841 | Indian Harbour Beach |
| Levee Liquors | ST CLOUD LEVEE LIQ&GAS | 700117509 | St Cloud |
| Loews Royal Pacific Resort | ROYAL PACIFIC RESORT | 700023644 | Orlando |
| Mainstreet Pib | MAINSTREET PUB | 700020122 | Melbourne |
| Malabar Liquors | MALABAR LIQUORS | 700020121 | Palm Bay |
| Market to Table | MARKET TO TABLE | 700157796 | Winter Garden |
| Maxine's on Shine | MAXINES ON SHINE | 700080183 | Orlando |
| McGregor's | MCGREGORS PUBLIC HOUSE | 700346345 | Ft Myers |
| Nick's Bar and Grill | NICKS BAR | 700007645 | Hollywood |
| Nineteen 61 | NINETEEN 61 | 700140791 | Lakeland |
| Noble Tavern | NOBLE TAVERN | 700418370 | St Petersburg |
| Nona Blue | NONA BLUE MODERN TAVERN | 700120488 | Orlando |
| Nona Social | NONA SOCIAL | 700202044 | Orlando |
| Not a Clue Bar & Grill | NOT A CLUE BAR & GRILL | 700139254 | St Cloud |
| Ocean Side Pub & Retail | OCEAN SIDE PUB OFF | 700010158 | Jensen Beach |
| Oceanside Liquors | OCEANSIDE LIQUORS | 700100964 | Melbourne Bch |
| Old Jailhouse | OLD JAIL HOUSE THE | 700240500 | Sanford |
| One Love Cafe | ONE LOVE CAFE INC | 700161373 | Gainesville |
| Outpost Eola | OUTPOST NEIGHBORHOOD TAVERN | 700421785 | Orlando |
| Pat's Liquor Leaf & Wine -Bourbon | PATS LIQ LEAF & WINE OFF N | 700158764 | Sanford |
| Pelican Marsh Golf -Courtside | COURTSIDE | 700339084 | Naples |
| Phyre Saloon | PHYRE BREWERY & TAVERN | 700283876 | St Cloud |
| Prime Catch | PRIME CATCH | 700015106 | Boynton Beach |
| Rebellion Beachside | REBELLION BEACHSIDE BAR | 700403681 | Cocoa Beach |
| Riggins Crab House | RIGGIN'S CRAB HOUSE | 700011541 | Lantana |
| River Hills CC | RIVER HILLS COUNTRY CLUB | 700021377 | Valrico |
| Roasted Spirits | ROASTED SPIRIT THE | 700314187 | Clermont |
| Root+Branch | ROOT & BRANCH BISTRO & BAR | 700344159 | Clermont |
| Ruby St Grille | RUBY STREET GRILLE | 700053837 | Tavares |
| Salty Fox | SALTY FOX THE | 700156492 | Melbourne |
| Sandbar Satellite | SANDBAR SATELLITE | 700419301 | Satellite Bch |
| Secrets Hideaway | SECRETS HIDEAWAY | 700077684 | Kissimmee |
| Shamrock Liquors | SHAMROCK BEVERAGE OFF | 700120787 | Orlando |
| Sly Fox | SLY FOX PUB | 700135563 | Orlando |
| Smoke & Donuts | SMOKE & DONUTS | 700398986 | Orlando |
| Swiggs | SWIGGS | 700144207 | Orlando |
| Tavern on the Bay | TAVERNA ON THE BAY | 700348482 | St Pete Bch |
| The Cabaret GLBT | CABARET THE | 700031247 | Pensacola |
| The Capital Room | CAPITAL ROOM SANFORD THE | 700346287 | Sanford |
| The Duck Tavern | DUCK TAVERN | 700010898 | Boca Raton |
| The Jellyfish | JELLYFISH BAR | 700030577 | Pensacola |
| The Point | POINTE THE | 700300347 | Gulf Breeze |
| The Porch WP | PORCH THE | 700129874 | Winter Park |
| The Station (formally Clermont Brewing) | STATION THE | 700436857 | Clermont |
| The Thirsty Fish | PORTOFINO BAY HOTEL | 700023437 | Orlando |
| The View | VIEW  THE | 700347642 | Clermont |
| The Wharf | WHARF AT SUNSET WALK/LIZZIES BBQ | 700339594 | Kissimmee |
| The Wildflower | WILDFLOWER THE | 700342126 | Sanford |
| The Yardery | YARDERY OF MOUNT DORA | 700408134 | Mount Dora |
| The Yardery - Mt Dora | YARDERY OF MOUNT DORA | 700408134 | Mount Dora |
| The Yardery - Sanford | YARDERY OF SANFORD THE | 700313310 | Sanford |
| Thirsty Bones | THIRSTY BONES | 700020041 | Merritt Island |
| Tide and Tonic | TIDE N TONIC | 700354525 | Indian Harbour Beach |
| Trick Shots III Winter Park | TRICK SHOTS III | 700023168 | Winter Park |
| VanBerry's | VAN BARRYS PUBLIC HOUSE | 700128028 | Orlando |
| Velvet Swan | VELVET SWAN THE | 700443160 | Lakeland |
| Vintage Vault | VINTAGE VAULT THE | 700440798 | Cocoa |
| Wildflower Sanford | WILDFLOWER THE | 700342126 | Sanford |

## Chains, one account across several customers

| Our account | Customer numbers | Note |
|---|---|---|
| Spirits2U | 700430855, 700117141, 700304007 | Rockledge, Merritt Island, Palm Bay. The portal carries only Palm Bay, the one with no volume. |
| Hampton Wine & Spirits | 700408287, 700408288 | Palm Beach on-premise and retail. Both ours, so they are summed. |

## Rejected, with reasons

Kept so nothing re-adopts them on a later run.

| Proposed | Rejected because |
|---|---|
| Ace Cafe of Sanford -> YARDERY OF SANFORD THE | Yardery already matched |
| Big C Liquors -> WALLYS BAR AND LIQUORS | Big C is ours, Wallys is not |
| Black Hawk Social -> NONA SOCIAL | separate accounts |
| Conrad's -> NONA SOCIAL | separate accounts |
| Crooked Spoon -> ROASTED SPIRIT THE | Roasted Spirits already matched |
| Devaneys Sport Pub -> AC SPORTS BAR | AC Sports Bar already matched |
| Hampton Wine & Spirits -> DRIFTWOOD WINE & SPIRITS | ours is Palm Beach, Driftwood is Santa Rosa |
| Keg Social -> NONA SOCIAL | separate accounts |
| Liquor Master -> BIG B LIQUORS THE | not the same shop, ruled 2026-09-02 |
| Maggie McFly PSL -> MAGGIE MCFLYS | not our account, ruled 2026-09-02 |
| Palm Beach Par 3 (Al Fresco) -> HAMPTONS PALM BEACH ON | different account |
| Pourhouse Lounge -> POURHOUSE THE DAPPER DUCK | ours is Satellite Beach and has never bought |
| RusTeak - Managerie -> STAGGER INN | different account |
| Secrets Resort -> SECRETS HIDEAWAY | same property as Secrets Hideaway, count once |
| Shamrock Liquors -> WALLYS BAR AND LIQUORS | Wallys is not ours |
| Total Wine #909 Colonial Dr. -> TOTAL WINE & MORE #909 | not our account, ruled 2026-09-02 |
| University wine and Spirit -> UNIVERSAL CITY DEV PARTNERS OPS | Universal Studios, not ours |

## The monthly routine

1. Pull the flash. The rep flags which accounts are ours; cross-check it.
2. Every account of ours with cases in **either** column gets a row. An account
   that sold last year and not this year is a real loss and must appear, or the
   year-over-year silently flatters us.
3. This year goes in the current master as `recurring case` at $0.00. Last year
   goes in the prior-year master as `Case Sale`.
4. **Net out cases already logged as a billed `Case Sale`**, or they double count.
5. New names appear every month. Propose them here; adopt only after a ruling.

## Known gaps

- **2025 has no reorders.** The 2025 master holds billed case sales only. Only
  **July 2025** has been reconciled. June 2026 currently reads **+212.5%**, which
  is fiction: June 2025 has 8 cases logged and no reorders. Every month before
  July needs the same backfill.
- Roughly **30 rows in the 2026 master carry a number in the Opportunity column**
  (`34100000000.0` and similar). They price to nothing and count as nothing.
- `market favors n/c` is on no rate card, so that work is invisible to every total.
- **Case counts are fractional** (9-litre equivalents). Florida July is 109.58,
  which is why the flash says 110 and a premise-split sum said 111.

