import sublime_plugin

from ..libs.viewhelpers import *
from ..libs.texthelpers import escape_html


class TypescriptQuickInfo(sublime_plugin.TextCommand):
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

    def is_enabled(self):
        return is_typescript(self.view)


class TypescriptQuickInfoDoc(sublime_plugin.TextCommand):
    """
    Command to show the doc string associated with quick info;
    re-runs quick info in case info has changed
    """
    def is_enabled(self):
        return is_typescript(self.view)

    def handle_quick_info(self, quick_info_resp_dict):
        if quick_info_resp_dict["success"]:
            info_str = quick_info_resp_dict["body"]["displayString"]
            # The finfoStr depends on the if result
            finfoStr = info_str
            doc_str = quick_info_resp_dict["body"]["documentation"]
            if len(doc_str) > 0:
                if not TOOLTIP_SUPPORT:
                    docPanel = sublime.active_window().get_output_panel("doc")
                    docPanel.run_command('typescript_show_doc',
                                         {'infoStr': info_str,
                                          'docStr': doc_str})
                    docPanel.settings().set('color_scheme', "Packages/Color Scheme - Default/Blackboard.tmTheme")
                    sublime.active_window().run_command('show_panel', {'panel': 'output.doc'})
                finfoStr = info_str + " (^T^Q for more)"
            self.view.set_status("typescript_info", finfoStr)
            if TOOLTIP_SUPPORT:
                hinfoStr = escape_html(info_str)
                hdocStr = escape_html(doc_str)
                html = "<div>" + hinfoStr + "</div>"
                if len(doc_str) > 0:
                    html += "<div>" + hdocStr + "</div>"
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
