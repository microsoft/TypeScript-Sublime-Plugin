import sublime_plugin

from ..libs import *
from ..libs.view_helpers import *
from ..libs.reference import *
from .base_command import TypeScriptBaseTextCommand


class TypescriptFindReferencesCommand(TypeScriptBaseTextCommand):
    """Find references command"""
    def run(self, text):
        check_update_view(self.view)
        references_resp = cli.service.references(self.view.file_name(), get_location_from_view(self.view))
        if references_resp["success"]:
            pos = self.view.sel()[0].begin()
            cursor = self.view.rowcol(pos)
            line = str(cursor[0] + 1)
            args = {"line": line, "filename": self.view.file_name(), "referencesRespBody": references_resp["body"]}
            args_json_str = json_helpers.encode(args)
            ref_view = get_ref_view()
            ref_view.run_command('typescript_populate_refs', {"argsJson": args_json_str})


class TypescriptGoToRefCommand(sublime_plugin.TextCommand):
    """
    If cursor is on reference line, go to (filename, line, offset) referenced by that line
    """
    def is_enabled(self):
        return global_vars.get_language_service_enabled()

    def run(self, text):
        pos = self.view.sel()[0].begin()
        cursor = self.view.rowcol(pos)
        ref_info = cli.get_ref_info()
        mapping = ref_info.get_mapping(str(cursor[0]))
        if mapping:
            (filename, l, c, p, n) = mapping.as_tuple()
            update_ref_line(ref_info, cursor[0], self.view)
            sublime.active_window().open_file(
                '{0}:{1}:{2}'.format(filename, l + 1 or 0, c + 1 or 0),
                sublime.ENCODED_POSITION
            )


# TODO: generalize this to work for all types of references
class TypescriptNextRefCommand(sublime_plugin.TextCommand):
    def is_enabled(self):
        return global_vars.get_language_service_enabled()

    def run(self, text):
        ref_view = get_ref_view()
        if ref_view:
            ref_info = cli.get_ref_info()
            line = ref_info.next_ref_line()
            pos = ref_view.text_point(int(line), 0)
            set_caret_pos(ref_view, pos)
            ref_view.run_command('typescript_go_to_ref')


# TODO: generalize this to work for all types of references
class TypescriptPrevRefCommand(sublime_plugin.TextCommand):
    """Go to previous reference in active references file"""
    def is_enabled(self):
        return global_vars.get_language_service_enabled()

    def run(self, text):
        ref_view = get_ref_view()
        if ref_view:
            ref_info = cli.get_ref_info()
            line = ref_info.prev_ref_line()
            pos = ref_view.text_point(int(line), 0)
            set_caret_pos(ref_view, pos)
            ref_view.run_command('typescript_go_to_ref')


# TODO: generalize this to populate any type of references file
class TypescriptPopulateRefs(sublime_plugin.TextCommand):
    """
    Helper command called by TypescriptFindReferences; put the references in the
    references buffer (such as build errors)
    """
    def is_enabled(self):
        return global_vars.get_language_service_enabled()

    def run(self, text, argsJson):
        args = json_helpers.decode(argsJson)
        file_name = args["filename"]
        line = args["line"]
        ref_display_string = args["referencesRespBody"]["symbolDisplayString"]
        ref_id = args["referencesRespBody"]["symbolName"]
        refs = args["referencesRespBody"]["refs"]

        file_count = 0
        match_count = 0
        self.view.set_read_only(False)
        # erase the caret showing the last reference followed
        self.view.erase_regions("curref")
        # clear the references buffer
        self.view.erase(text, sublime.Region(0, self.view.size()))
        header = "References to {0} \n\n".format(ref_display_string)
        self.view.insert(text, self.view.sel()[0].begin(), header)
        self.view.set_syntax_file("Packages/" + PLUGIN_NAME + "/FindRefs.hidden-tmLanguage")
        window = sublime.active_window()
        ref_info = None
        if len(refs) > 0:
            prev_file_name = ""
            prev_line = None
            for ref in refs:
                file_name = ref["file"]
                if prev_file_name != file_name:
                    file_count += 1
                    if prev_file_name != "":
                        self.view.insert(text, self.view.sel()[0].begin(), "\n")
                    self.view.insert(text, self.view.sel()[0].begin(), file_name + ":\n")
                    prev_file_name = file_name
                start_location = ref["start"]
                (l, c) = extract_line_offset(start_location)
                pos = self.view.sel()[0].begin()
                cursor = self.view.rowcol(pos)
                line = str(cursor[0])
                if not ref_info:
                    ref_info = cli.init_ref_info(line, ref_id)
                ref_info.add_mapping(line, Ref(file_name, l, c, prev_line))
                if prev_line:
                    mapping = ref_info.get_mapping(prev_line)
                    mapping.set_next_line(line)
                prev_line = line
                content = ref["lineText"]
                display_ref = "    {0}:  {1}\n".format(l + 1, content)
                match_count += 1
                self.view.insert(text, self.view.sel()[0].begin(), display_ref)
        ref_info.set_last_line(line)
        self.view.insert(text, self.view.sel()[0].begin(),
                         "\n{0} matches in {1} file{2}\n".format(match_count,
                                                                 file_count, "" if (file_count == 1) else "s"))
        if match_count > 0:
            highlight_ids(self.view, ref_id)
        window.focus_view(self.view)
        set_caret_pos(self.view, self.view.text_point(2, 0))
        # serialize the reference info into the settings
        self.view.settings().set('refinfo', ref_info.as_value())
        self.view.set_read_only(True)
