from ..libs.view_helpers import *
from .base_command import TypeScriptBaseTextCommand


class TypescriptSave(TypeScriptBaseTextCommand):
    """Save file command

    For debugging, send command to server to save server buffer in temp file
    TODO: safe temp file name on Windows
    """
    def run(self, text):
        cli.service.save_to(self.view.file_name(), "/tmp/curstate")
