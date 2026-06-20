from typing import Protocol

from app.game.constants import SECRET_SOLVER_TYPES


class SecretSolver(Protocol):
    def validate_config(self, config: dict) -> None: ...

    def verify_guess(self, config: dict, guess: str) -> bool: ...

    def client_hints(self, config: dict) -> dict: ...


class CodewordSolver:
    def validate_config(self, config: dict) -> None:
        answer = config.get("answer")
        if not answer or not str(answer).strip():
            raise ValueError("Codeword secret requires an answer")

    def verify_guess(self, config: dict, guess: str) -> bool:
        answer = str(config.get("answer", ""))
        guess_str = guess.strip()
        if config.get("case_sensitive"):
            return guess_str == answer
        return guess_str.lower() == answer.lower()

    def client_hints(self, config: dict) -> dict:
        return {"type": "codeword"}


class NumberLockSolver:
    def validate_config(self, config: dict) -> None:
        length = int(config.get("length", 5))
        code = str(config.get("code", ""))
        if len(code) != length or not code.isdigit():
            raise ValueError(f"Number lock requires a {length}-digit numeric code")

    def verify_guess(self, config: dict, guess: str) -> bool:
        code = str(config.get("code", ""))
        return guess.strip() == code

    def client_hints(self, config: dict) -> dict:
        length = int(config.get("length", 5))
        return {"type": "number_lock", "length": length}


SOLVER_REGISTRY: dict[str, SecretSolver] = {
    "codeword": CodewordSolver(),
    "number_lock": NumberLockSolver(),
}


def get_solver(solver_type: str) -> SecretSolver:
    if solver_type not in SOLVER_REGISTRY:
        raise ValueError(f"Unknown secret solver type: {solver_type}")
    return SOLVER_REGISTRY[solver_type]


def validate_solver_type(solver_type: str) -> None:
    if solver_type not in SECRET_SOLVER_TYPES:
        raise ValueError(f"Invalid solver type. Must be one of: {', '.join(SECRET_SOLVER_TYPES)}")
