import codecs

from .global_vars import *
from .editor_client import cli
from .text_helpers import *
from .panel_manager import get_panel_manager


class FileInfo:
    """Per-file info"""

    def __init__(self, filename, cc):
        self.filename = filename
        self.is_open = False
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
        self.change_count_when_last_err_req_sent = -1
        self.last_modify_change_count = cc
        self.modify_count = 0


_file_map = dict()
_file_map_on_worker = dict()


def get_info(view, open_if_not_cached=True):
    """Find the file info on the server that matches the given view"""
    if not get_language_service_enabled():
        return
    
    if not cli.initialized:
        cli.initialize()

    info = None
    if view is not None and view.file_name() is not None:
        file_name = view.file_name()
        if is_typescript(view):
            info = _file_map.get(file_name)
            if open_if_not_cached:
                if not info or info.is_open is False:
                    info = FileInfo(file_name, None)
                    info.view = view
                    info.client_info = cli.get_or_add_file(file_name)
                    set_file_prefs(view)
                    _file_map[file_name] = info
                    # Open the file on the server
                    open_file(view)
                    info.is_open = True
                    if view.is_dirty():
                        if not view.is_loading():
                            reload_buffer(view, info.client_info)
                        else:
                            info.client_info.pending_changes = True

                # This is for the case when a file is opened on server but not
                # on the worker, which could be caused by starting the worker
                # for the first time
                if not IS_ST2:
                    if get_panel_manager().is_panel_active("errorlist"):
                        info_on_worker = _file_map_on_worker.get(file_name)
                        if not info_on_worker:
                            _file_map_on_worker[file_name] = info
                            open_file_on_worker(view)
                            if view.is_dirty() and not view.is_loading():
                                reload_buffer_on_worker(view)
                    else:
                        _file_map_on_worker.clear()
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
    """Test if the outer syntactic scope is 'source.ts' or 'source.tsx' """
    if not view.file_name():
        return False

    try:
        location = view.sel()[0].begin()
    except:
        return False

    return (view.match_selector(location, 'source.ts') or
            view.match_selector(location, 'source.tsx'))


def is_special_view(view):
    """Determine if the current view is a special view.

    Special views are mostly referring to panels. They are different from normal views
    in that they cannot be the active_view of their windows, therefore their ids 
    shouldn't be equal to the current view id.
    """
    return view is not None and view.window() and view.id() != view.window().active_view().id()


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

def open_file_on_worker(view):
    """Open the file on the worker process"""
    cli.service.open_on_worker(view.file_name())

def reconfig_file(view):
    """Reconfigure indentation settings for the current view

    Returns True if the settings were configured in the TS service
    Returns False if the settings did not need to be configured
    """
    host_info = "Sublime Text version " + str(sublime.version())
    # Preferences Settings
    view_settings = view.settings()
    tab_size = view_settings.get('tab_size', 4)
    indent_size = view_settings.get('indent_size', tab_size)
    translate_tabs_to_spaces = view_settings.get('translate_tabs_to_spaces', True)

    prev_format_options = view_settings.get('typescript_plugin_format_options')
    if prev_format_options == None \
        or prev_format_options['tabSize'] != tab_size \
        or prev_format_options['indentSize'] != indent_size \
        or prev_format_options['convertTabsToSpaces'] != translate_tabs_to_spaces:
        format_options = {
            "tabSize": tab_size,
            "indentSize": indent_size,
            "convertTabsToSpaces": translate_tabs_to_spaces
        }
        view_settings.set('typescript_plugin_format_options', format_options)
        cli.service.configure(host_info, view.file_name(), format_options)
        return True
    return False


def set_file_prefs(view):
    settings = view.settings()
    settings.set('use_tab_stops', False)
    settings.add_on_change('typescript_plugin_settings_changed', settings_changed)


def settings_changed():
    view = active_view()
    if view is None:
        return
    if reconfig_file(view):
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

        if not client_info:
            client_info = cli.get_or_add_file(view.file_name())

        if not IS_ST2:
            cli.service.reload_async(view.file_name(), tmpfile_name, recv_reload_response)
            client_info.change_count = view.change_count()
        else:
            # Sublime 2 doesn't have good support for multi threading
            reload_response = cli.service.reload(view.file_name(), tmpfile_name)
            recv_reload_response(reload_response)
            info = get_info(view)
            client_info.change_count = info.modify_count
        client_info.pending_changes = False

def reload_buffer_on_worker(view):
    """Reload the buffer content on the worker process

    Note: the worker process won't change the client_info object to avoid synchronization issues
    """
    if not view.is_loading():
        tmpfile_name = get_tempfile_name()
        tmpfile = codecs.open(tmpfile_name, "w", "utf-8")
        text = view.substr(sublime.Region(0, view.size()))
        tmpfile.write(text)
        tmpfile.flush()
        if not IS_ST2:
            cli.service.reload_async_on_worker(view.file_name(), tmpfile_name, recv_reload_response)
        else:
            reload_response = cli.service.reload_on_worker(view.file_name(), tmpfile_name)
            recv_reload_response(reload_response)

def reload_required(view):
    client_info = cli.get_or_add_file(view.file_name())
    return client_info.pending_changes or client_info.change_count < change_count(view)


def check_update_view(view):
    """Check if the buffer in the view needs to be reloaded

    If we have changes to the view not accounted for by change messages, 
    send the whole buffer through a temporary file
    """
    if is_typescript(view):
        client_info = cli.get_or_add_file(view.file_name())
        if reload_required(view):
            reload_buffer(view, client_info)


def send_replace_changes_for_regions(view, regions, insert_string):
    """
    Given a list of regions and a (possibly zero-length) string to insert, 
    send the appropriate change information to the server.
    """
    if not is_typescript(view):
        return
    for region in regions:
        location = get_location_from_position(view, region.begin())
        end_location = get_location_from_position(view, region.end())
        cli.service.change(view.file_name(), location, end_location, insert_string)


def apply_edit(text, view, start_line, start_offset, end_line, end_offset, new_text=""):
    """Apply a single edit specification to a view"""
    begin = view.text_point(start_line, start_offset)
    end = view.text_point(end_line, end_offset)
    region = sublime.Region(begin, end)
    send_replace_changes_for_regions(view, [region], new_text)
    # break replace into two parts to avoid selection changes
    if region.size() > 0:
        view.erase(text, region)
    if len(new_text) > 0:
        view.insert(text, begin, new_text.replace('\r\n', '\n'))


def apply_formatting_changes(text, view, code_edits):
    """Apply a set of edits to a view"""
    if code_edits:
        for code_edit in code_edits[::-1]:
            start_line, start_offset = extract_line_offset(code_edit["start"])
            end_line, end_offset = extract_line_offset(code_edit["end"])
            new_text = code_edit["newText"]
            apply_edit(text, view, start_line, start_offset, end_line, end_offset, new_text=new_text)


def insert_text(view, edit, loc, text):
    view.insert(edit, loc, text)
    send_replace_changes_for_regions(view, [sublime.Region(loc, loc)], text)
    if not IS_ST2:
        client_info = cli.get_or_add_file(view.file_name())
        client_info.change_count = view.change_count()
    check_update_view(view)


def format_range(text, view, begin, end):
    """Format a range of locations in the view"""
    if not is_typescript(view):
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

def last_non_whitespace_position(view):
    """
    Returns the position of the last non-whitespace character of <view>.
    Returns -1 if <view> only contains non-whitespace characters.
    """
    pos = view.size() - 1
    while pos >= 0 and view.substr(pos).isspace():
        pos -= 1
    return pos

def last_visible_character_region(view):
    """Returns a <sublime.Region> for the last non whitespace character"""
    pos = last_non_whitespace_position(view)
    return sublime.Region(pos, pos + 1)

def is_view_visible(view):
    """The only way to tell a view is visible seems to be to test if it has an attached window"""
    return view.window() is not None

