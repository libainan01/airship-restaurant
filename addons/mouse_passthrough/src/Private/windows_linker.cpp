#include "Public/windows_linker.h"
#include <godot_cpp/core/class_db.hpp>
#include <iostream>

using namespace godot;


windows_linker::windows_linker()
{
}

windows_linker::~windows_linker()
{
}

void windows_linker::enable_mouse_passthrough()
{
	std::cout << "Link Success" << std::endl;
}

void windows_linker::_bind_methods()
{
	ClassDB::bind_method(D_METHOD("enable_mouse_passthrough"), &windows_linker::enable_mouse_passthrough);
}