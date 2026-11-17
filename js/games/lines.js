// Fixed words for the games: the Would You Rather prompts, and every fixed sentence the games can say out loud.
// Loaded with play.js (so api.play.phrases() can list every line without opening a game). No state, no DOM.
// Text style: plain, warm, no em dashes, no exclamation marks except real celebrations.

/** Would You Rather, road trip edition. Original and family friendly. "Would you rather <a> or <b>?" */
export const WYR = [
  // food stops
  ["eat a giant burger at a roadside diner", "share a mountain of fries with everyone in the car"],
  ["have a milkshake that never melts", "have a bag of warm pretzels that never runs out"],
  ["eat only tacos for the whole trip", "eat only pancakes for the whole trip"],
  ["pick every snack stop yourself", "let someone else pick every snack stop"],
  ["eat warm cookies at every rest stop", "eat ice cream at every gas station"],
  ["have a smoothie with every fruit in it", "have a milkshake with every candy in it"],
  ["eat a sandwich as long as your arm", "eat a pizza as wide as the back seat"],
  ["have dessert before every meal", "have breakfast for dinner every night"],
  ["have a picnic beside a river", "have a picnic at the top of a mountain pass"],
  ["try a food you have never heard of at every stop", "get your favorite food at every stop"],
  ["eat fries that taste like pizza", "eat popcorn that tastes like pancakes"],
  ["have a snack drawer in the car that refills itself with crackers", "have a snack drawer in the car that refills itself with fruit"],
  ["sip hot chocolate on a snowy mountain", "sip lemonade on a hot summer afternoon"],
  ["have a waiter who sings your order", "have a waiter who brings your food on roller skates"],
  ["eat all your meals standing on one foot", "eat all your meals wearing a silly hat"],
  ["eat soup with a fork", "eat spaghetti with a spoon"],
  ["eat a giant cinnamon roll for breakfast", "eat a giant stack of waffles for breakfast"],
  ["have a lunch stop at a tiny diner with great pie", "have a lunch stop at a huge market with a hundred snacks"],
  ["have a cold drink that stays cold all day", "have a warm snack that stays warm all day"],
  ["have every meal taste like your favorite food", "have every snack come in a surprise flavor"],
  // landscapes
  ["drive past a snowy mountain every day", "drive past the ocean every day"],
  ["see a field of wildflowers that goes on forever", "see a night sky full of stars with no city lights"],
  ["wake up beside a quiet lake", "wake up in a forest of tall trees"],
  ["drive through a tunnel made of trees", "drive across a bridge made of glass"],
  ["stop at a tall waterfall", "stop at a huge sand dune"],
  ["spend a day exploring a cave", "spend a day exploring tide pools"],
  ["see a whale leap out of the sea", "see an eagle swoop down to a river"],
  ["ride a train through the mountains", "ride a boat down a river"],
  ["watch a sunrise over the hills", "watch a sunset over the ocean"],
  ["drive in fog so thick it feels like a cloud", "drive in sunshine so bright you need two pairs of sunglasses"],
  ["camp under one huge old tree", "camp beside a bubbling creek"],
  ["drive past an orchard that goes on forever", "drive past a field of sunflowers that goes on forever"],
  ["see a rainbow every time it rains", "see a shooting star every night"],
  ["visit a place with a million birds", "visit a place with a hundred friendly horses"],
  ["hike up a small hill and see for miles", "float on a calm lake and see nothing but sky"],
  ["drive a road that goes up and down like a roller coaster", "drive a road that is perfectly straight for a hundred miles"],
  ["find a hidden beach that nobody else knows about", "find a hidden waterfall that nobody else knows about"],
  ["see a huge mountain that changes color at sunset", "see a huge lake that is perfectly still"],
  // superpowers for long drives
  ["be able to pause traffic for one minute", "be able to turn every red light green"],
  ["have a car that can float across water", "have a car that can glide over traffic"],
  ["make every bathroom stop take only one minute", "make every gas stop come with a free snack"],
  ["know the name of every town you pass", "know a fun fact about every sign you see"],
  ["have a car that sings along with any song", "have a car that tells a story whenever you ask"],
  ["talk to any animal you see out the window", "understand every bird you hear"],
  ["have a seat that is always perfectly comfy", "have a window that always shows the best view"],
  ["never get carsick", "never get bored"],
  ["see the next rest stop from ten miles away", "smell the next bakery from ten miles away"],
  ["make a boring hour feel like one minute", "make the best part of the day last for hours"],
  ["have a magic map that always finds the shortest way", "have a magic compass that always points to the best snack"],
  ["have a pillow that fits perfectly in any seat", "have a blanket that is always the perfect temperature"],
  ["turn the car into a boat whenever you want", "turn the car into a tent whenever you want"],
  ["have a button that plays your favorite song", "have a button that picks the perfect snack"],
  ["have a car horn that plays any tune you choose", "have windshield wipers that wave to other cars"],
  ["magically know how many miles are left", "magically know what the weather will be at the next stop"],
  // silly
  ["have a pet llama who rides along", "have a pet penguin who rides along"],
  ["talk only in rhymes for an hour", "talk only in whispers for an hour"],
  ["wear a funny hat for the whole trip", "wear giant sunglasses for the whole trip"],
  ["have a car horn that moos", "have a car horn that quacks"],
  ["have shoes that squeak with every step", "have hair that changes color with every song"],
  ["give every cow you see a silly name", "give every truck you see a silly name"],
  ["have a talking map that tells jokes", "have a talking map that tells riddles"],
  ["be in charge of the music for the whole day", "be in charge of the map for the whole day"],
  ["have a rubber duck as your co-pilot", "have a stuffed bear as your co-pilot"],
  ["find a treasure map in the glove box", "find a secret snack in the glove box"],
  ["sing every song in a funny voice", "sing every song very, very slowly"],
  ["have a car that smells like pancakes", "have a car that smells like fresh cut grass"],
  ["give a speech about your favorite animal", "act out your favorite movie without talking"],
  ["talk like a robot for ten minutes", "talk like a pirate for ten minutes"],
  ["have a car with a glass roof", "have a car with a roof that opens like a giant sunroof"],
  ["wear socks on your hands", "wear mittens on your feet"],
  ["have a tail that wags when you are happy", "have wings that are too small to fly"],
  ["invent a brand new road sign", "invent a brand new snack"],
  ["wave at every truck driver", "count every red car"],
  ["have a seat that spins slowly", "have a seat that bounces gently"],
  // the trip itself
  ["sit in traffic with your favorite music", "drive on an empty road in total silence"],
  ["take the slow road with the best views", "take the fast road with nothing to see"],
  ["pack one giant suitcase", "pack five tiny bags"],
  ["arrive early and wait around", "arrive late after seeing something amazing on the way"],
  ["get the window seat all trip", "get the middle seat with all the snacks"],
  ["play road games all day", "listen to a great story all day"],
  ["take a long trip with your best friend", "take a short trip with your whole family"],
  ["stop at every interesting sign you see", "never stop until you reach the end"],
];

/** Fixed sentences the games say. Anything spoken that is not here is built from the app's own data (see phrases() in play.js). */
export const LINES = {
  right: "That's right.",
  notQuite: "Not quite.",
  hol: { right: "That's right.", wrong: "Not quite.", best: "A new best streak." },
  plates: {
    rare: { HI: "Hawaii. That is a rare find.", AK: "Alaska. That is a rare find." },
    all: "That is all fifty states and D.C. Every plate is found.",
  },
  hunt: { done: "You found everything on the list. Stamp earned." },
  alpha: { done: "You made it from A to Z." },
  where: { good: "That's right.", miss: "Not quite.", round: "That is the round." },
  wyrLead: "Would you rather",
};
export const wyrSpeech = p => `${LINES.wyrLead} ${p[0]}, or ${p[1]}?`;
export const alphaSpeech = l => `Find a word that starts with ${l}.`;

/** Tips for the hard letters. Spoken only when the person taps the speaker. */
export const ALPHA_TIPS = {
  Q: "Q is a tough one. Try Quick, Quality, Quarter or Quiet.",
  X: "X is sneaky. The word Exit counts, and so does Xing on a railroad crossing.",
  Z: "Z is rare. Try Zone, Zero, Zoo or Zip.",
};
export const alphaTipSpeech = l => ALPHA_TIPS[l] || "";
