import sublime_plugin

from ..libs.view_helpers import *
from .base_command import TypeScriptBaseTextCommand


class TypescriptErrorInfo(TypeScriptBaseTextCommand):
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
                break
        for (region, text) in client_info.errors['semanticDiag']:
            if region.contains(pt):
                error_text = text
                break

        if len(error_text) > 0:
            if PHANTOM_SUPPORT:
                template = '<body><style>div.error {{ background-color: brown; padding: 5px; color: white }}</style><div class="error">{0}</div></body>'
                display_text = template.format(error_text)
                self.view.add_phantom("typescript_error", self.view.sel()[0], display_text, sublime.LAYOUT_BLOCK)
            self.view.set_status("typescript_error", error_text)