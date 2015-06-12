from .global_vars import *


class Ref:
    """Reference item in the 'Find All Reference' view

    A reference to a source file, line, offset; next and prev refer to the 
    next and previous reference in a view containing references
    """

    def __init__(self, filename, line, offset, prev_line):
        self.filename = filename
        self.line = line
        self.offset = offset
        self.next_line = None
        self.prev_line = prev_line

    def set_next_line(self, n):
        self.next_line = n

    def as_tuple(self):
        return self.filename, self.line, self.offset, self.prev_line, self.next_line


class RefInfo:
    """Maps (line in view containing references) to (filename, line, offset) referenced"""

    def __init__(self, first_line, ref_id):
        self.ref_map = {}
        self.current_ref_line = None
        self.first_line = first_line
        self.last_line = None
        self.ref_id = ref_id

    def set_last_line(self, last_line):
        self.last_line = last_line

    def add_mapping(self, line, target):
        self.ref_map[line] = target

    def contains_mapping(self, line):
        return line in self.ref_map

    def get_mapping(self, line):
        if line in self.ref_map:
            return self.ref_map[line]

    def get_current_mapping(self):
        if self.current_ref_line:
            return self.get_mapping(self.current_ref_line)

    def set_ref_line(self, line):
        self.current_ref_line = line

    def get_ref_line(self):
        return self.current_ref_line

    def get_ref_id(self):
        return self.ref_id

    def next_ref_line(self):
        current_mapping = self.get_current_mapping()
        if (not self.current_ref_line) or (not current_mapping):
            self.current_ref_line = self.first_line
        else:
            (filename, l, c, p, n) = current_mapping.as_tuple()
            if n:
                self.current_ref_line = n
            else:
                self.current_ref_line = self.first_line
        return self.current_ref_line

    def prev_ref_line(self):
        current_mapping = self.get_current_mapping()
        if (not self.current_ref_line) or (not current_mapping):
            self.current_ref_line = self.last_line
        else:
            (filename, l, c, p, n) = current_mapping.as_tuple()
            if p:
                self.current_ref_line = p
            else:
                self.current_ref_line = self.last_line

        return self.current_ref_line

    def as_value(self):
        vmap = {}
        keys = self.ref_map.keys()
        for key in keys:
            vmap[key] = self.ref_map[key].as_tuple()
        return vmap, self.current_ref_line, self.first_line, self.last_line, self.ref_id


def build_ref(ref_tuple):
    """Build a Ref from a serialized Ref"""
    (filename, line, offset, prev_line, next_line) = ref_tuple
    ref = Ref(filename, line, offset, prev_line)
    ref.set_next_line(next_line)
    return ref


def build_ref_info(ref_info_tuple):
    """Build a RefInfo object from a serialized RefInfo"""
    (dict, current_line, first_line, last_line, ref_id) = ref_info_tuple
    ref_info = RefInfo(first_line, ref_id)
    ref_info.set_ref_line(current_line)
    ref_info.set_last_line(last_line)
    for key in dict.keys():
        ref_info.add_mapping(key, build_ref(dict[key]))
    return ref_info


def highlight_ids(view, ref_id):
    """Highlight all occurrences of ref_id in view"""
    id_regions = view.find_all("(?<=\W)" + ref_id + "(?=\W)")
    if id_regions and (len(id_regions) > 0):
        if IS_ST2:
            view.add_regions("refid", id_regions, "constant.numeric", "", sublime.DRAW_OUTLINED)
        else:
            view.add_regions("refid", id_regions, "constant.numeric",
                             flags=sublime.DRAW_NO_FILL | sublime.DRAW_NO_OUTLINE | sublime.DRAW_SOLID_UNDERLINE)


def update_ref_line(ref_info, cur_line, view):
    """Update the given line in reference view

    Update the gutter icon
    """
    # Todo: make sure the description is right

    view.erase_regions("curref")
    caret_pos = view.text_point(cur_line, 0)
    # sublime 2 doesn't support custom icons
    icon = "Packages/" + PLUGIN_NAME + "/icons/arrow-right3.png" if not IS_ST2 else ""
    view.add_regions(
        "curref",
        [sublime.Region(caret_pos, caret_pos + 1)],
        "keyword",
        icon,
        sublime.HIDDEN
    )
