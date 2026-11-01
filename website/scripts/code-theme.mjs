// Syntax colors for the dark green code blocks, based on the Everforest palette.
const color = (foreground, scope, fontStyle) => ({
  scope,
  settings: fontStyle ? { foreground, fontStyle } : { foreground },
});

export const codeTheme = {
  name: "map-master",
  type: "dark",
  colors: { "editor.background": "#173328", "editor.foreground": "#e2e9dc" },
  tokenColors: [
    color("#8fa596", ["comment", "punctuation.definition.comment"], "italic"),
    color("#a8b8ac", ["punctuation", "meta.brace", "keyword.operator.type.annotation"]),
    color("#e67e80", [
      "keyword",
      "keyword.control",
      "keyword.operator.new",
      "keyword.operator.expression",
      "storage.modifier",
      "entity.name.tag",
    ]),
    color("#e69875", ["storage.type", "entity.other.attribute-name"]),
    color("#dbbc7f", ["string", "string.quoted", "string.template", "punctuation.definition.string"]),
    color("#d699b6", ["constant.numeric", "constant.language", "constant.character", "support.constant"]),
    color("#a7c080", [
      "entity.name.function",
      "support.function",
      "meta.function-call entity.name.function",
      "variable.function",
    ]),
    color("#7fbbb3", [
      "entity.name.type",
      "entity.name.class",
      "support.type",
      "support.class",
      "entity.other.inherited-class",
      "support.type.primitive",
    ]),
    color("#83c092", [
      "variable.other.property",
      "variable.other.object.property",
      "meta.object-literal.key",
      "support.variable.property",
      "support.type.property-name",
    ]),
    color("#e2e9dc", ["variable", "variable.other.readwrite", "variable.parameter"]),
  ],
};
