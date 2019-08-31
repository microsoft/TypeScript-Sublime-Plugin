from ..libs.view_helpers import *
from ..libs.text_helpers import escape_html
from .base_command import TypeScriptBaseTextCommand
from ..libs.popup_manager import load_html_template
from ..libs.popup_formatter import get_theme_styles
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

            if "documentation" in quick_info_resp_dict["body"]:
                doc_str = self.format_display_parts_html(quick_info_resp_dict["body"]["documentation"])

            # process documentation
            if len(doc_str) > 0:
                if not TOOLTIP_SUPPORT:
                    doc_panel = sublime.active_window().get_output_panel("doc")
                    doc_panel.run_command(
                        'typescript_show_doc',
                        {'infoStr': info_str, 'docStr': doc_str}
                    )
                    doc_panel.settings().set('color_scheme', "Packages/Color Scheme - Default/Blackboard.tmTheme")
                    sublime.active_window().run_command('show_panel', {'panel': 'output.doc'})
                status_info_str = info_str + " (^T^Q for more)"
            self.view.set_status("typescript_info", status_info_str)

        else:
            self.view.erase_status("typescript_info")

        # Fetch any errors and show tooltips if available
        error_html = self.get_error_text_html(sublime.Region(display_point, display_point))
        if info_str != "" or doc_str != "" or error_html != "":
            self.show_tooltip_popup(display_point, error_html, info_str, doc_str)

    def show_tooltip_popup(self, display_point, error, info, doc):
        if not TOOLTIP_SUPPORT:
            return

        theme_styles = get_theme_styles(self.view)

        parameters = {
            "error": error or '',
            "info_str": info or '',
            "doc_str": doc or '',
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

        if self.template is None:
            self.template = Template(load_quickinfo_and_error_popup_template())
        html = self.template.substitute(parameters)

        settings = sublime.load_settings("TypeScript.sublime-settings")
        self.view.show_popup(
            html,
            flags=sublime.HIDE_ON_MOUSE_MOVE_AWAY,
            location=display_point,
            max_height=300,
            max_width=settings.get("quick_info_popup_max_width") or self.view.viewport_extent()[0]
        )

    def get_error_text_html(self, span):
        client_info = cli.get_or_add_file(self.view.file_name())
        all_errors = client_info.errors['syntacticDiag'] + client_info.errors['semanticDiag']

        errors = []
        for (region, text) in all_errors:
            if region.intersects(span):
                errors.append(escape_html(text))

        return '<br/>'.join(errors)

    def run(self, text, hover_point=None, hover_zone=None):
        check_update_view(self.view)
        display_point = self.view.sel()[0].begin() if hover_point is None else hover_point
        word_at_sel = self.view.classify(display_point)
        if hover_zone == sublime.HOVER_GUTTER:
            line_span = self.view.full_line(display_point)
            error_html = self.get_error_text_html(line_span)
            if error_html:
                self.show_tooltip_popup(display_point, error_html, None, None)
        elif word_at_sel & SUBLIME_WORD_MASK:
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
