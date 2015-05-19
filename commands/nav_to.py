from ..libs import *
from ..libs.view_helpers import *
from ..libs.reference import *
from .base_command import TypeScriptBaseWindowCommand


class TypescriptNavToCommand(TypeScriptBaseWindowCommand):
    nav_to_panel_started = False

    # indicate weather the insert_text command has finished pasting text into the textbox,
    # during which time the on_modified callback shouldn't run
    insert_text_finished = False
    input_text = ""

    @classmethod
    def reset(cls):
        cls.nav_to_panel_started = False
        cls.insert_text_finished = False

    def run(self, input_text=""):
        logger.log.debug("start running nav_to with text: %s" % input_text)

        TypescriptNavToCommand.reset()
        TypescriptNavToCommand.input_text = input_text
        TypescriptNavToCommand.nav_to_panel_started = True

        # Text used for querying is not always equal to the input text. This is because the quick
        # panel will disappear if an empty list is provided, and we want to avoid this. Therefore
        # when some input text that will result in empty results is given (for example, empty
        # string), we use alternative text to ensure the panel stay active
        query_text = "a" if input_text == "" else input_text
        response_dict = cli.service.nav_to(query_text, self.window.active_view().file_name())
        if response_dict["success"]:
            items = response_dict["body"]
            self.items = items if len(items) != 0 else self.items

            self.window.show_quick_panel(self.format_nav_to_result(self.items), self.on_done)
            logger.log.debug("end running nav_to with text: %s" % input_text)

    def on_done(self, index):
        TypescriptNavToCommand.reset()

        if index >= 0:
            item = self.items[index]
            line, offset = item['start']['line'], item['start']['offset']
            file_at_location = item['file'] + ":%s:%s" % (line, offset)
            self.window.open_file(file_at_location, sublime.ENCODED_POSITION)

    def format_nav_to_result(self, item_list):
        def get_description_str(item):
            name = item["name"]
            kind = item["kind"]
            container_kind = item["containerKind"] if "containerKind" in item else os.path.basename(item["file"]) + " (global)"
            container_name = item["containerName"] if "containerName" in item else ""
            description_str = "{0} in {1} {2}".format(kind, container_kind, container_name)
            return [name, description_str]

        return [get_description_str(item) for item in item_list]

    def on_highlight(self, index):
        pass
