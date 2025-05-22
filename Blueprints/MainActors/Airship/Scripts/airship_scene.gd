class_name Airship_Scene
extends Node2D

func get_polygon2D() -> Polygon2D:
	return get_child(0).get_child(4)

func get_mainwindow() -> Window:
	return get_window()
