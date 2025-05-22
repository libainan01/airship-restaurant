class_name MainScene
extends Node2D
@export var background_fps = 60
@export var foreground_fps = 60

var Airship:Airship_Scene

func get_airship()->Node2D :
	return get_node("AirShip")
func get_resturant()->Node2D:
	return get_node("Resturant")
func get_truck()->Node2D:
	return get_node("Truck")

func _ready() -> void:	
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
	
func _input(event: InputEvent) -> void:
	if event.is_action_pressed("textButton"):
		get_window().mouse_passthrough_polygon = Airship.get_polygon2D().polygon
