class_name MainScene
extends Node2D


func _get_mouse_click_space() -> MouseClickSpace:
	return get_child(0)

func _init() -> void:
	var screencount = DisplayServer.get_screen_count()
	#get_window().current_screen = DisplayServer.get_primary_screen()
