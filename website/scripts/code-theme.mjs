// A light syntax palette for the shadcn Code Block surface.
const color = (foreground, scope, fontStyle) => ({
  scope,
  settings: fontStyle ? { foreground, fontStyle } : { foreground },
});

export const codeTheme = {
  name: "map-master",
  type: "light",
  colors: { "editor.background": "#fafbf9", "editor.foreground": "#24292f" },
  tokenColors: [
    color("#6a737d", ["comment", "punctuation.definition.comment"], "italic"),
    color("#57606a", ["punctuation", "meta.brace", "keyword.operator.type.annotation"]),
    color("#cf222e", [
      "keyword",
      "keyword.control",
      "keyword.operator.new",
      "keyword.operator.expression",
      "storage.modifier",
      "entity.name.tag",
    ]),
    color("#953800", ["storage.type", "entity.other.attribute-name"]),
    color("#0a3069", ["string", "string.quoted", "string.template", "punctuation.definition.string"]),
    color("#0550ae", ["constant.numeric", "constant.language", "constant.character", "support.constant"]),
    color("#6639ba", [
      "entity.name.function",
      "support.function",
      "meta.function-call entity.name.function",
      "variable.function",
    ]),
    color("#0550ae", [
      "entity.name.type",
      "entity.name.class",
      "support.type",
      "support.class",
      "entity.other.inherited-class",
      "support.type.primitive",
    ]),
    color("#116329", [
      "variable.other.property",
      "variable.other.object.property",
      "meta.object-literal.key",
      "support.variable.property",
      "support.type.property-name",
    ]),
    color("#24292f", ["variable", "variable.other.readwrite", "variable.parameter"]),
  ],
};
