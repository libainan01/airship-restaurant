class_name restauranteur
extends AnimatedSprite2D

const NOTE_MANAGER_PATH = preload("res://Item/Scripts/NoteManager.gd")
var NOTE_MANAGER : NoteManager

func _ready() -> void:
	NOTE_MANAGER = NOTE_MANAGER_PATH.new() as NoteManager

func _on_key_monitor_settlement_work_status_signal(work_state: key_monitor.WORK_STATE) -> void:
	
	NOTE_MANAGER.spawn_note(global_position,"类型A",get_tree().current_scene)
	
	
