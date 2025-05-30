class_name MainScene
extends Node2D

func _get_mouse_click_space() -> MouseClickSpace:
	return get_child(0)
