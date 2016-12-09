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
            info_str = quick_info_resp_dict["body"]["displayString"]
            status_info_str = info_str
            doc_str = quick_info_resp_dict["body"]["documentation"]
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

        # process tooltips
        error_html = self.get_error_text_html(display_point)
        if TOOLTIP_SUPPORT and (info_str != "" or doc_str != "" or error_html != ""):
            if self.template is None:
                self.template = Template(load_quickinfo_and_error_popup_template())
            text_parts = { "error": error_html, "info_str": escape_html(info_str), "doc_str": escape_html(doc_str) }
            html = self.template.substitute(text_parts)
            self.view.show_popup(html, flags=sublime.HIDE_ON_MOUSE_MOVE_AWAY, location=display_point, max_height=300, max_width=1500)

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
            cli.service.quick_info(self.view.file_name(), get_location_from_position(self.view, display_point), lambda response: self.handle_quick_info(response, display_point))
        else:
            self.view.erase_status("typescript_info")
