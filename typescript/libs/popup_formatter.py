
def format_css(style):
    """
    Given a style object from view.style_for_scope, converts the styles into
    a CSS string
    """
    result = ""

    if (style["foreground"]):
        result += "color: {0};".format(style["foreground"])

    if (style["bold"]):
        result += "font-weight: bold;"

    if (style["italic"]):
        result += "font-style: italic;"

    return result

def get_theme_styles(view):
    """
    Given a view object, pulls styling information from the current theme for
    syntax highlighting popups
    """
    return {
        "type": format_css(view.style_for_scope("entity.name.type.class.ts")),
        "keyword": format_css(view.style_for_scope("keyword.control.flow.ts")),
        "name": format_css(view.style_for_scope("entity.name.function")),
        "param": format_css(view.style_for_scope("variable.language.arguments.ts")),
        "property": format_css(view.style_for_scope("variable.other.property.ts")),
        "punctuation": format_css(view.style_for_scope("punctuation.definition.block.ts")),
        "variable": format_css(view.style_for_scope("meta.var.expr.ts")),
        "function": format_css(view.style_for_scope("entity.name.function.ts")),
        "interface": format_css(view.style_for_scope("entity.name.type.interface.ts")),
        "string": format_css(view.style_for_scope("string.quoted.single.ts")),
        "number": format_css(view.style_for_scope("constant.numeric.decimal.ts")),
        "text": format_css(view.style_for_scope("source.ts"))
    }
