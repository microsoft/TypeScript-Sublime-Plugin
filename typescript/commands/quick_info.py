from ..libs.view_helpers import *
from ..libs.text_helpers import escape_html
from .base_command import TypeScriptBaseTextCommand
from ..libs.popup_manager import load_html_template
from string import Template

def load_quickinfo_and_error_popup_template():
    return load_html_template("quickinfo_and_error_popup.html")

class TypescriptQuickInfo(TypeScriptBaseTextCommand):
    """Command currently called only from event handlers"""

    def handle_quick_info(self, quick_info_resp_dict):
        if quick_info_resp_dict["success"]:
            info_str = quick_info_resp_dict["body"]["displayString"]
            doc_str = quick_info_resp_dict["body"]["documentation"]
            if len(doc_str) > 0:
                info_str += " (^T^Q for more)"
            self.view.set_status("typescript_info", info_str)
        else:
            self.view.erase_status("typescript_info")

    def run(self, text):
        check_update_view(self.view)
        word_at_sel = self.view.classify(self.view.sel()[0].begin())
        if word_at_sel & SUBLIME_WORD_MASK:
            cli.service.quick_info(self.view.file_name(), get_location_from_view(self.view), self.handle_quick_info)
        else:
            self.view.erase_status("typescript_info")


class TypescriptQuickInfoDoc(TypeScriptBaseTextCommand):
    """
    Command to show the doc string associated with quick info;
    re-runs quick info in case info has changed
    """
    template = None

    def handle_quick_info(self, quick_info_resp_dict, display_point):
        info_str = ""
        doc_str = ""

        if quick_info_resp_dict["success"]:
            info_str = self.format_display_parts_html(quick_info_resp_dict["body"]["displayParts"])
            status_info_str = self.format_display_parts_plain(quick_info_resp_dict["body"]["displayParts"])
            doc_str = self.format_display_parts_html(quick_info_resp_dict["body"]["documentation"])

            # process documentation
            if len(doc_str) > 0:
                if not TOOLTIP_SUPPORT:
                    doc_panel = sublime.active_window().get_output_panel("doc")
                    doc_panel.run_command(
                        'typescript_show_doc',
                        {'infoStr': info_str, 'docStr': doc_str}
                    )
                    # doc_panel.settings().set('color_scheme', "Packages/Color Scheme - Default/Blackboard.tmTheme")
                    sublime.active_window().run_command('show_panel', {'panel': 'output.doc'})
                status_info_str = info_str + " (^T^Q for more)"
            self.view.set_status("typescript_info", status_info_str)

        else:
            self.view.erase_status("typescript_info")

        # process tooltips
        error_html = self.get_error_text_html(display_point)
        if TOOLTIP_SUPPORT and (info_str != "" or doc_str != "" or error_html != ""):
            if self.template is None:
                self.template = Template(load_quickinfo_and_error_popup_template())
                
            html = self.get_popup_html(error_html, info_str, doc_str)

            print(html)

            self.view.show_popup(html, flags=sublime.HIDE_ON_MOUSE_MOVE_AWAY, location=display_point, max_height=300, max_width=1500)

    def get_popup_html(self, error, info, doc):
        theme_styles = self.get_theme_styles()

        parameters = {
            "error": error,
            "info_str": info,
            "doc_str": doc,
            "typeStyles": theme_styles["type"],
            "keywordStyles": theme_styles["keyword"],
            "nameStyles": theme_styles["name"],
            "paramStyles": theme_styles["param"],
            "propertyStyles": theme_styles["property"],
            "punctuationStyles": theme_styles["punctuation"],
            "variableStyles": theme_styles["variable"],
            "functionStyles": theme_styles["function"],
            "interfaceStyles": theme_styles["interface"],
            "stringStyles": theme_styles["string"],
            "numberStyles": theme_styles["number"],
            "textStyles": theme_styles["text"]
        }

        return self.template.substitute(parameters)

    def get_error_text_html(self, pt):
        client_info = cli.get_or_add_file(self.view.file_name())
        error_text = ""
        for (region, text) in client_info.errors['syntacticDiag']:
            if region.contains(pt):
                error_text = text
                break
        for (region, text) in client_info.errors['semanticDiag']:
            if region.contains(pt):
                error_text = text
                break
        return escape_html(error_text)

    def run(self, text, hover_point=None):
        check_update_view(self.view)
        display_point = self.view.sel()[0].begin() if hover_point is None else hover_point
        word_at_sel = self.view.classify(display_point)
        if word_at_sel & SUBLIME_WORD_MASK:
            cli.service.quick_info_full(self.view.file_name(), get_location_from_position(self.view, display_point), lambda response: self.handle_quick_info(response, display_point))
        else:
            self.view.erase_status("typescript_info")

    def map_kind_to_html_class(self, kind):
        return kind

    def format_display_parts_html(self, display_parts):
        def html_escape(str):
            return str.replace('&', '&amp;').replace('<', '&lt;').replace('>', "&gt;").replace('\n', '<br>').replace(' ', '&nbsp;')

        result = ""
        template = '<span class="{0}">{1}</span>'

        for part in display_parts:
            result += template.format(self.map_kind_to_html_class(part["kind"]), html_escape(part["text"]))

        return result

    def format_display_parts_plain(self, display_parts):
        result = ""
        for part in display_parts:
            result += part["text"]

        return result

    def format_css(self, style):
        result = ""

        if (style["foreground"]):
            result += "color: {0};".format(style["foreground"])

        if (style["bold"]):
            result += "font-weight: bold;"

        if (style["italic"]):
            result += "font-style: italic;"

        return result

    def get_theme_styles(self):
        print(self.view.style_for_scope("keyword.control.flow.ts"))

        return {
            "type": self.format_css(self.view.style_for_scope("entity.name.type.class.ts")),
            "keyword": self.format_css(self.view.style_for_scope("keyword.control.flow.ts")),
            "name": self.format_css(self.view.style_for_scope("entity.name.function")),
            "param": self.format_css(self.view.style_for_scope("variable.language.arguments.ts")),
            "property": self.format_css(self.view.style_for_scope("variable.other.property.ts")),
            "punctuation": self.format_css(self.view.style_for_scope("punctuation.definition.block.ts")),
            "variable": self.format_css(self.view.style_for_scope("meta.var.expr.ts")),
            "function": self.format_css(self.view.style_for_scope("entity.name.function.ts")),
            "interface": self.format_css(self.view.style_for_scope("entity.name.type.interface.ts")),
            "string": self.format_css(self.view.style_for_scope("string.quoted.single.ts")),
            "number": self.format_css(self.view.style_for_scope("constant.numeric.decimal.ts")),
            "text": self.format_css(self.view.style_for_scope("source.ts"))
        }
