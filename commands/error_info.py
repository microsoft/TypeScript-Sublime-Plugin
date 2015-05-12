import sublime_plugin

from ..libs.viewhelpers import *


class TypescriptErrorInfo(sublime_plugin.TextCommand):
    """
    Command called from event handlers to show error text in status line
    (or to erase error text from status line if no error text for location)
    """
    def run(self, text):
        client_info = cli.get_or_add_file(self.view.file_name())
        pt = self.view.sel()[0].begin()
        error_text = ""
        for (region, text) in client_info.errors['syntacticDiag']:
            if region.contains(pt):
                error_text = text
        for (region, text) in client_info.errors['semanticDiag']:
            if region.contains(pt):
                error_text = text
        if len(error_text) > 0:
            self.view.set_status("typescript_error", error_text)
        else:
            self.view.erase_status("typescript_error")
