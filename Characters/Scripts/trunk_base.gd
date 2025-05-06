class_name trunk_base
extends Node2D
var Kitchen:kitchen_control
@onready var TrunkTimer = $Pulley/TrunkTimer


enum TRUNK_STATE{
	TOEND = 0,
	TOSTART = 1,
	WAITATSTART = 2,
	WAITATEND = 3
}

var current_trunk_state:TRUNK_STATE = TRUNK_STATE.WAITATSTART

signal trunk_state_change_signal(message:TRUNK_STATE)

var Capacity = 4
var CurrentCapacity = 0

func _ready() -> void:
	Kitchen = get_node("/root/MainScene/AirShip/AirShip/KitchenControl")
	change_trunk_state(TRUNK_STATE.WAITATSTART)

func packing (num:int)->void :
	CurrentCapacity += num
	Kitchen.send_dining(num)
	if CurrentCapacity >= Capacity:
		emit_signal("trunk_state_change_signal",TRUNK_STATE.TOEND)
		change_trunk_state(TRUNK_STATE.TOEND)

func get_dining ()->void:
	CurrentCapacity -= 1
	if CurrentCapacity == 0 :
		change_trunk_state(TRUNK_STATE.TOSTART)

func is_empty()->bool:
	return false

func change_trunk_state(trunk_state:TRUNK_STATE)->void:
	current_trunk_state = trunk_state
	match current_trunk_state:
		TRUNK_STATE.TOSTART:
			TrunkTimer.stop()
		TRUNK_STATE.TOEND:
			TrunkTimer.stop()
		TRUNK_STATE.WAITATSTART:
			TrunkTimer.start(1)
		TRUNK_STATE.WAITATEND:
			TrunkTimer.start(1)

func _on_trunk_timer_timeout() -> void:
	if current_trunk_state == TRUNK_STATE.WAITATSTART:
		packing(2)
	if current_trunk_state == TRUNK_STATE.WAITATEND:
		get_dining()
	pass # Replace with function body.
