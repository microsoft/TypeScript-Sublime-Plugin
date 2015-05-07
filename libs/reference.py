import sublime, sublime_plugin

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
        return (self.filename, self.line, self.offset, self.prev_line, self.next_line)

def build_ref(ref_tuple):
    """Build a Ref from a serialized Ref"""
    (filename, line, offset, prev_line, next_line) = ref_tuple
    ref = Ref(filename, line, offset, prev_line)
    ref.set_next_line(next_line)
    return ref

def build_ref_info(ref_info_tuple):
    """Build a RefInfo object from a serialized RefInfo"""
    (dict, currentLine, first_line, last_line, ref_id) = ref_info_tuple
    ref_info = RefInfo(first_line, ref_id)
    ref_info.set_ref_line(currentLine)
    ref_info.setLastLine(last_line)
    for key in dict.keys():
        ref_info.addMapping(key, build_ref(dict[key]))
    return ref_info

