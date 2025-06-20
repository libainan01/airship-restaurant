#pragma once
#ifndef WINDOWSLINKER_H
#define WINDOWSLINKER_H

#include <godot_cpp/classes/object.hpp>

class WindowController;

using namespace godot;

class windows_linker : public Object
{
    GDCLASS(windows_linker, Object)
protected:
    static void _bind_methods();

public:

    void enable_mouse_passthrough();

    windows_linker();
    ~windows_linker();

};

#endif