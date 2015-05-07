import sublime_plugin

from ..libs import *
from ..libs.viewhelpers import *
from ..libs.reference import *


class TypescriptSignaturePanel(sublime_plugin.TextCommand):
    def is_enabled(self):
        return is_typescript(self.view)

    def run(self, text):
        print('TypeScript signature panel triggered')
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
            signatureText = get_text_from_parts(signature["prefixDisplayParts"])
            snippetText = ""
            paramIdx = 1

            if signature["parameters"]:
                for param in signature["parameters"]:
                    if paramIdx > 1:
                        signatureText += ", "
                        snippetText += ", "

                    paramText = ""
                    paramText += get_text_from_parts(param["displayParts"])
                    signatureText += paramText
                    snippetText += "${" + str(paramIdx) + ":" + paramText + "}"
                    paramIdx += 1

            signatureText += get_text_from_parts(signature["suffixDisplayParts"])
            self.results.append(signatureText)
            self.snippets.append(snippetText)

    def on_selected(self, index):
        if index == -1:
            return

        self.view.run_command('insert_snippet',
                              {"contents": self.snippets[index]})


class TypescriptSignaturePopup(sublime_plugin.TextCommand):
    def is_enabled(self):
        return TOOLTIP_SUPPORT and is_typescript(self.view)

    def run(self, edit, move=None):
        logger.log.debug('In run for signature popup with move: {0}'.format(move if move else 'None'))
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

