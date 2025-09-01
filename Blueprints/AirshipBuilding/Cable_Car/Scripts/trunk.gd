class_name Trunk
extends Node2D
var Kitchen:kitchen_control

signal capacity_changes (trunk_state:TRUNK_STATE,current_capacity:int)

enum TRUNK_STATE{
	EMPTY,
	FULL
}

var current_trunk_state:TRUNK_STATE = TRUNK_STATE.EMPTY

var _capacity = 4
var _currentCapacity = 0

func _ready() -> void:
	pass

func put_in (num:int)->void :
	_currentCapacity += num
	if _currentCapacity >= _capacity:
		_change_trunk_state(TRUNK_STATE.FULL)
		capacity_changes.emit(current_trunk_state,_currentCapacity)

func take_out ()->void:
	_currentCapacity -= 1
	if _currentCapacity == 0 :
		_change_trunk_state(TRUNK_STATE.EMPTY)
		capacity_changes.emit(current_trunk_state,_currentCapacity)

func is_empty()->bool:
	return false
	
func _change_trunk_state(new_state:TRUNK_STATE) ->void:
	current_trunk_state = new_state
	pass
