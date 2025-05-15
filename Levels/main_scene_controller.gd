class_name MainScene
extends Node2D
@export var background_fps = 60
@export var foreground_fps = 60

func get_airship()->Node2D :
	return get_node("AirShip")
func get_resturant()->Node2D:
	return get_node("Resturant")
func get_truck()->Node2D:
	return get_node("Truck")

func _ready() -> void:
	var window_controller_class = load("res://Script/window_controller.cs")
	
	var hwnd = DisplayServer.window_get_native_handle(DisplayServer.WINDOW_HANDLE)
#	hwnd.input_pickable = false
	
	if window_controller_class != null:
		var window_controller = window_controller_class.new() 
		add_child(window_controller)
		#window_controller.set_window_click_through(hwnd)
	pass
func _notification(what: int) -> void:
	match what:
		NOTIFICATION_APPLICATION_FOCUS_OUT:
			_enter_background_mode()
		NOTIFICATION_APPLICATION_FOCUS_IN:
			_enter_foreground_mode()
			
func _enter_background_mode() -> void:
	get_tree().paused = false

func _enter_foreground_mode() -> void:
	pass
