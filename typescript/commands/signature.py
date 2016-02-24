import sublime_plugin

from ..libs import *
from ..libs.view_helpers import *
from ..libs.reference import *
from .base_command import TypeScriptBaseTextCommand


class TypescriptSignaturePanel(TypeScriptBaseTextCommand):
    def run(self, text):
        logger.log.debug('TypeScript signature panel triggered')
        self.results = []
        self.snippets = []
        cli.service.signature_help(
            self.view.file_name(),
            get_location_from_view(self.view), '',
            self.on_results
        )
        if self.results:
            self.view.window().show_quick_panel(self.results, self.on_selected)

    def on_results(self, response_dict):
        if not response_dict["success"] or not response_dict["body"]:
            return

        def get_text_from_parts(display_parts):
            result = ""
            if display_parts:
                for part in display_parts:
                    result += part["text"]
            return result

        for signature in response_dict["body"]["items"]:
            signature_text = get_text_from_parts(signature["prefixDisplayParts"])
            snippet_text = ""
            param_id_x = 1

            if signature["parameters"]:
                for param in signature["parameters"]:
                    if param_id_x > 1:
                        signature_text += ", "
                        snippet_text += ", "

                    param_text = ""
                    param_text += get_text_from_parts(param["displayParts"])
                    signature_text += param_text
                    snippet_text += "${" + str(param_id_x) + ":" + param_text + "}"
                    param_id_x += 1

            signature_text += get_text_from_parts(signature["suffixDisplayParts"])
            self.results.append(signature_text)
            self.snippets.append(snippet_text)

    def on_selected(self, index):
        if index == -1:
            return

        self.view.run_command('insert_snippet', {"contents": self.snippets[index]})


class TypescriptSignaturePopup(sublime_plugin.TextCommand):
    def is_enabled(self):
        return TOOLTIP_SUPPORT and is_typescript(self.view) and get_language_service_enabled()

    def run(self, edit, move=None):
        log.debug('In run for signature popup with move: {0}'.format(move if move else 'None'))
        if not TOOLTIP_SUPPORT:
            return

        popup_manager = get_popup_manager()
        if move is None:
            popup_manager.queue_signature_popup(self.view)
        elif move == 'prev':
            popup_manager.move_prev()
        elif move == 'next':
            popup_manager.move_next()
        else:
            raise ValueError('Unknown arg: ' + move)

