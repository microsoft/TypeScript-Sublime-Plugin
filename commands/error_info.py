import sublime_plugin

from ..libs.viewhelpers import *


class TypescriptErrorInfo(sublime_plugin.TextCommand):
    """
    Command called from event handlers to show error text in status line
    (or to erase error text from status line if no error text for location)
    """
    def run(self, text):
        clientInfo = cli.get_or_add_file(self.view.file_name())
        pt = self.view.sel()[0].begin()
        errorText = ""
        for (region, text) in clientInfo.errors['syntacticDiag']:
            if region.contains(pt):
                errorText = text
        for (region, text) in clientInfo.errors['semanticDiag']:
            if region.contains(pt):
                errorText = text
        if len(errorText) > 0:
            self.view.set_status("typescript_error", errorText)
        else:
            self.view.erase_status("typescript_error")
