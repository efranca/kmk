import { fold } from "./search";

// Word stems (English, French, Portuguese; no accents, lower case) that point to one of the icons the picker offers.
// The table is in order of specificity: the first icon with a matching word wins, so "wash windows" is 🪟, not 🧹.
const TABLE: readonly (readonly [string, string])[] = [
  ["🪟", "window vitre vidro janela glass"],
  ["🚽", "toilet bathroom restroom washroom banheiro sanit toilette salle-de-bain lavabo"],
  ["🔧", "repair fix mainten reparer repar consert depann plomb plumb"],
  ["📞", "call phone telephon appel ligar telefon rappel"],
  ["🛒", "buy shop supplies grocer costco achat achet compra mercado courses supermarket"],
  ["🧺", "laundry linge lessive lavanderia roupa towel serviette toalha"],
  ["🚗", "car vehicle truck voiture camion carro caminh deliver livr entrega"],
  ["🧹", "mop sweep clean dust vacuum tidy nettoy balay ranger aspir limp varr arrum poeira poussiere"],
  ["🧽", "scrub sponge frott esponja esfreg"],
  ["🧴", "soap detergent product produit sabao sabonete savon"],
  ["🏢", "office bureau escritorio client building immeuble predio"],
  ["🏠", "house home maison casa residen"],
  ["🪴", "plant garden jardin planta jardim"],
  ["📅", "meeting rendez-vous reuniao reunion schedule horaire agenda"],
  ["📦", "box package parcel colis caixa pacote inventory inventaire estoque"],
  ["💼", "invoice facture fatura contract contrat contrato quote soumission orcamento"],
  ["✅", "check inspect verif inspec vistoria"],
];

/** The icon for a task title ("Mop the floor" → 🧹), or "" when no word of it matches. */
export function suggestIcon(title: string): string {
  const words = fold(title).split(/[^\p{L}\p{N}-]+/u).filter((w) => w.length >= 3);
  for (const [icon, stems] of TABLE) {
    const list = stems.split(" ");
    if (words.some((w) => list.some((s) => w === s || (s.length >= 3 && w.startsWith(s))))) return icon;
  }
  return "";
}
