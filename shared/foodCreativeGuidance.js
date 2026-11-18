const FOOD_SUBJECT_PATTERN = /(?:\b(?:food|dish|meal|recipe|cooking?|cuisine|curry|soup|stew|stir[ -]?fry|fried rice|noodles?|dessert|cake|pastr(?:y|ies)|salad)\b|ម្ហូប|ធ្វើម្ហូប|ចម្អិន|រូបមន្ត|គ្រឿងផ្សំ|សម្ល|បាយ|គុយទាវ|មី|ឆា|ចៀន|អាំង|ស្ងោរ|អាម៉ុក|នំ)/iu;

const EXPLICIT_NON_RECIPE_PATTERN = /(?:\b(?:advertis(?:e|ement|ing)|promo(?:tion|tional)?|commercial|marketing|restaurant|cafe|menu|product[ -]?shot|packag(?:e|ing)|food review|mukbang|dining|eating)\b|ផ្សាយពាណិជ្ជកម្ម|ផ្សព្វផ្សាយ|ប្រូម៉ូសិន|ភោជនីយដ្ឋាន|ហាងកាហ្វេ|ម៉ឺនុយ|វេចខ្ចប់|រីវីយូ|ញ៉ាំ|បរិភោគ)/iu;

export const isFoodCreativeRequest = (value) => FOOD_SUBJECT_PATTERN.test(String(value || ''));

export const wantsNonRecipeFoodCreative = (value) => EXPLICIT_NON_RECIPE_PATTERN.test(String(value || ''));

export const shouldDefaultToFoodPreparation = (value) => (
  isFoodCreativeRequest(value) && !wantsNonRecipeFoodCreative(value)
);

export const foodPreparationGuidance = (value, mediaType = 'video') => {
  if (!shouldDefaultToFoodPreparation(value)) return '';

  if (mediaType === 'image') {
    return `

FOOD PREPARATION DEFAULT: Treat this food subject as a practical cooking how-to. Show authentic preparation in progress with recognizable ingredients, real cookware and utensils, and a clear key cooking action. The finished dish may be visible as the result, but do not default to only a static plated beauty shot, a person merely eating, or a presenter posing beside food.`;
  }

  return `

FOOD PREPARATION DEFAULT: Treat this food subject as a practical cooking how-to. In one coherent sequence, establish recognizable ingredients and preparation, show the key cooking action using real cookware, utensils and heat, then reveal the naturally plated finished dish. Keep hands anatomically correct and make the ingredient transformation physically believable. Do not default to a static plated beauty shot, a person merely eating, or a presenter talking beside food.`;
};
