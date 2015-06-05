from ..libs.view_helpers import *
from ..libs.text_helpers import escape_html
from .base_command import TypeScriptBaseTextCommand


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

    def handle_quick_info(self, quick_info_resp_dict):
        if quick_info_resp_dict["success"]:
            info_str = quick_info_resp_dict["body"]["displayString"]
            status_info_str = info_str
            doc_str = quick_info_resp_dict["body"]["documentation"]
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
            if TOOLTIP_SUPPORT:
                html_info_str = escape_html(info_str)
                html_doc_str = escape_html(doc_str)
                html = "<div>" + html_info_str + "</div>"
                if len(doc_str) > 0:
                    html += "<div>" + html_doc_str + "</div>"
                self.view.show_popup(html, location=-1, max_width=800)
        else:
            self.view.erase_status("typescript_info")

    def run(self, text):
        check_update_view(self.view)
        word_at_sel = self.view.classify(self.view.sel()[0].begin())
        if word_at_sel & SUBLIME_WORD_MASK:
            cli.service.quick_info(self.view.file_name(), get_location_from_view(self.view), self.handle_quick_info)
        else:
            self.view.erase_status("typescript_info")
