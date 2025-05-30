class_name key_monitor
extends Node
@onready var restauranteur_time_line = $RestauranteurTimeLine

enum WORK_STATE
{
	workhard = 0,
	rest = 1,
	worknormal = 2
}

signal settlement_work_status_signal(work_state:WORK_STATE)

var current_work_state : WORK_STATE = WORK_STATE.rest #当前的工作状态

var workload : int
func _ready() -> void:
	restauranteur_time_line.start(600)

func _on_restauranteur_time_line_timeout() -> void:
	_settlement_work_status(current_work_state)#每隔10分钟结算一次工作状态

func _input(event: InputEvent) -> void:
	if event is InputEventKey:
		workload += 1
	if workload <= 500:
		_change_work_state(WORK_STATE.rest)
	if workload <= 1000 and workload >500:
		_change_work_state(WORK_STATE.worknormal)
	if workload >= 1000:
		_change_work_state(WORK_STATE.workhard)
	#print("PressButton %s"%[workload])

func _settlement_work_status(work_state:WORK_STATE)->void:
	match work_state:
		WORK_STATE.rest:
			_rest_event()
		WORK_STATE.worknormal:
			_worknormal_event()
		WORK_STATE.workhard:
			_workhard_event()
	emit_signal("settlement_work_status_signal",work_state)#后续需要根据不同的WORK_STATE选择不同的文本库

func _workhard_event()->void:
	pass
func _worknormal_event()->void:
	pass
func _rest_event()->void:
	pass

func _change_work_state(new_work_state:WORK_STATE) ->void:
	pass
