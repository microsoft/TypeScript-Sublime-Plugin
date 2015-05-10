import codecs

from .globalvars import *
from .editorclient import cli
from .texthelpers import *


class FileInfo:
    """Per-file info"""

    def __init__(self, filename, cc):
        self.filename = filename
        # 'pre_change_sent' means the change to this file is already sent to the server
        # used between 'on_text_command' and 'on_modified'
        self.pre_change_sent = False
        # 'change_sent' has the same function with 'pre_change_sent', only it is
        # used between 'on_modified' and 'on_selection_modified'
        self.change_sent = False
        self.modified = False
        self.completion_prefix_sel = None
        self.completion_sel = None
        self.last_completion_loc = None
        self.last_completions = None
        self.last_completion_prefix = None
        self.prev_sel = None
        self.view = None
        self.has_errors = False
        self.client_info = None
        self.change_count_err_req = -1
        self.last_modify_change_count = cc
        self.modify_count = 0


_file_map = dict()
most_recent_used_file_list = []


def get_info(view):
    """Find the file info on the server that matches the given view"""
    info = None
    if view.file_name() is not None:
        file_name = view.file_name()
        if is_typescript(view):
            info = _file_map.get(file_name)
            if not info:
                info = FileInfo(file_name, None)
                info.view = view
                info.client_info = cli.get_or_add_file(file_name)
                set_file_prefs(view)
                _file_map[file_name] = info
                # Open the file on the server
                open_file(view)
                if view.is_dirty():
                    if not view.is_loading():
                        reload_buffer(view, info.client_info)
                    else:
                        info.client_info.pending_changes = True
                if info in most_recent_used_file_list:
                    most_recent_used_file_list.remove(info)
                most_recent_used_file_list.append(info)
    return info


def get_info_with_filename(filename):
    return _file_map[filename] if filename in _file_map else None


def active_view():
    """Return currently active view"""
    return sublime.active_window().active_view()


def active_window():
    """Return currently active window"""
    return sublime.active_window()


def is_typescript(view):
    """Test if the outer syntactic scope is 'source.ts' """
    if not view.file_name():
        return False
    try:
        location = view.sel()[0].begin()
    except:
        return False

    return view.match_selector(location, 'source.ts')


def is_typescript_scope(view, scope_sel):
    """Test if the cursor is in a syntactic scope specified by selector scopeSel"""
    try:
        location = view.sel()[0].begin()
    except:
        return False

    return view.match_selector(location, scope_sel)


def is_special_view(view):
    """Determine if the current view is a special view.

    Special views are mostly referring to panels. They are different from normal views
    in that they cannot be the active_view of their windows, therefore their ids 
    shouldn't be equal to the current view id.
    """
    return view.window() and view.id() != view.window().active_view().id()


def get_location_from_view(view):
    """Returns the Location tuple of the beginning of the first selected region in the view"""
    region = view.sel()[0]
    return get_location_from_region(view, region)


def get_location_from_region(view, region):
    """Returns the Location tuple of the beginning of the given region"""
    position = region.begin()
    return get_location_from_position(view, position)


def get_location_from_position(view, position):
    """Returns the LineOffset object of the given text position"""
    cursor = view.rowcol(position)
    line = cursor[0] + 1
    offset = cursor[1] + 1
    return Location(line, offset)


def open_file(view):
    """Open the file on the server"""
    cli.service.open(view.file_name())


def reconfig_file(view):
    host_info = "Sublime Text version " + str(sublime.version())
    # Preferences Settings
    view_settings = view.settings()
    tab_size = view_settings.get('tab_size', 4)
    indent_size = view_settings.get('indent_size', tab_size)
    translate_tab_to_spaces = view_settings.get('translate_tabs_to_spaces', True)
    format_options = {
        "tabSize": tab_size,
        "indentSize": indent_size,
        "convertTabsToSpaces": translate_tab_to_spaces
    }
    cli.service.configure(host_info, view.file_name(), format_options)


def set_file_prefs(view):
    settings = view.settings()
    settings.set('use_tab_stops', False)
    settings.add_on_change('tab_size', tab_size_changed)
    settings.add_on_change('indent_size', tab_size_changed)
    settings.add_on_change('translate_tabs_to_spaces', tab_size_changed)
    reconfig_file(view)


def tab_size_changed():
    view = active_view()
    reconfig_file(view)
    client_info = cli.get_or_add_file(view.file_name())
    client_info.pending_changes = True


def set_caret_pos(view, pos):
    view.sel().clear()
    view.sel().add(pos)


def get_tempfile_name():
    """Get the first unused temp file name to avoid conflicts"""
    seq = cli.service.seq
    if len(cli.available_tempfile_list) > 0:
        tempfile_name = cli.available_tempfile_list.pop()
    else:
        tempfile_name = os.path.join(PLUGIN_DIR, ".tmpbuf" + str(cli.tmpseq))
        cli.tmpseq += 1
    cli.seq_to_tempfile_name[seq] = tempfile_name
    return tempfile_name


def recv_reload_response(reload_resp):
    """Post process after receiving a reload response"""
    if reload_resp["request_seq"] in cli.seq_to_tempfile_name:
        tempfile_name = cli.seq_to_tempfile_name.pop(reload_resp["request_seq"])
        if tempfile_name:
            cli.available_tempfile_list.append(tempfile_name)


def reload_buffer(view, client_info=None):
    """Write the buffer of view to a temporary file and have the server reload it"""
    if not view.is_loading():
        tmpfile_name = get_tempfile_name()
        tmpfile = codecs.open(tmpfile_name, "w", "utf-8")
        text = view.substr(sublime.Region(0, view.size()))
        tmpfile.write(text)
        tmpfile.flush()
        cli.service.reload_async(view.file_name(), tmpfile_name, recv_reload_response)
        if not IS_ST2:
            if not client_info:
                client_info = cli.get_or_add_file(view.file_name())
                client_info.change_count = view.change_count()
                client_info.pending_changes = False


def check_update_view(view):
    """Check if the buffer in the view needs to be reloaded

    If we have changes to the view not accounted for by change messages, 
    send the whole buffer through a temporary file
    """
    if is_typescript(view):
        client_info = cli.get_or_add_file(view.file_name())
        if cli.reload_required(view):
            reload_buffer(view, client_info)


def send_replace_changes_for_regions(view, regions, insert_string):
    """
    Given a list of regions and a (possibly zero-length) string to insert, 
    send the appropriate change information to the server.
    """
    if IS_ST2 or not is_typescript(view):
        return
    for region in regions:
        location = get_location_from_position(view, region.begin())
        end_location = get_location_from_position(view, region.end())
        cli.service.change(view.file_name(), location, end_location, insert_string)


def apply_edit(text, view, startl, startc, endl, endc, ntext=""):
    """Apply a single edit specification to a view"""
    begin = view.text_point(startl, startc)
    end = view.text_point(endl, endc)
    region = sublime.Region(begin, end)
    send_replace_changes_for_regions(view, [region], ntext)
    # break replace into two parts to avoid selection changes
    if region.size() > 0:
        view.erase(text, region)
    if (len(ntext) > 0):
        view.insert(text, begin, ntext)


def apply_formatting_changes(text, view, code_edits):
    """Apply a set of edits to a view"""
    if code_edits:
        for code_edit in code_edits[::-1]:
            startlc = code_edit["start"]
            (startl, startc) = extract_line_offset(startlc)
            endlc = code_edit["end"]
            (endl, endc) = extract_line_offset(endlc)
            newText = code_edit["newText"]
            apply_edit(text, view, startl, startc, endl, endc, ntext=newText)


def insert_text(view, edit, loc, text):
    view.insert(edit, loc, text)
    send_replace_changes_for_regions(view, [sublime.Region(loc, loc)], text)
    if not IS_ST2:
        client_info = cli.get_or_add_file(view.file_name())
        client_info.change_count = view.change_count()
    check_update_view(view)


def format_range(text, view, begin, end):
    """Format a range of locations in the view"""
    if (not is_typescript(view)):
        print("To run this command, please first assign a file name to the view")
        return
    check_update_view(view)
    format_resp = cli.service.format(
        view.file_name(),
        get_location_from_position(view, begin),
        get_location_from_position(view, end)
    )
    if format_resp["success"]:
        code_edits = format_resp["body"]
        apply_formatting_changes(text, view, code_edits)
    if not IS_ST2:
        client_info = cli.get_or_add_file(view.file_name())
        client_info.change_count = view.change_count()


def get_ref_view(create=True):
    """
    If the FindReferences view is active, get it
    TODO: generalize this so that we can find any scratch view
    containing references to other files
    """
    for view in active_window().views():
        if view.name() == "Find References":
            return view
    if create:
        ref_view = active_window().new_file()
        ref_view.set_name("Find References")
        ref_view.set_scratch(True)
        return ref_view


def change_count(view):
    info = get_info(view)
    if info:
        if IS_ST2:
            return info.modify_count
        else:
            return view.change_count()